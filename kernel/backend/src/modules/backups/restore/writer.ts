import { badRequest, DbError } from "@ryot-app/contract/errors";
import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { BackupBadRequest } from "@ryot-app/contract/modules/backups/schemas";
import {
	builtinSavedViewReference,
	definitionKey,
	definitionOwner,
	identityTupleKey,
	pluginPackageKey,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityBrowserSavedViewSettings,
	type SavedViewRenderer,
} from "@ryot-app/contract/modules/saved-views/schemas";
import {
	type BackupRunId,
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginId,
	SavedViewId,
	SignalSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect, Layer, Schema, Stream } from "effect";
import { SecureRandom } from "effect/crypto";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import {
	type DataReferenceError,
	rewriteManagedAssetLocators,
	rewritePropertyReferences,
} from "#modules/backups/data-references";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import {
	buildDefinitionSnapshot,
	type DefinitionSnapshot,
	definitionSourceFromSnapshot,
} from "#modules/definitions/snapshot";
import { mergeManifestDefinitions } from "#modules/definitions/source";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { EventGroupConstraints } from "#modules/events/event-group-constraints";
import { eventPropertyReferences } from "#modules/events/event-references";
import { RESTORE_EVENT_BATCH_SIZE } from "#modules/events/repository";
import { resolveIntegrationSettingsSchema } from "#modules/integrations/settings-schema";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { validateRestoredProperties } from "#modules/plugins/configuration/revisions";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { validateAdditiveSchemaEvolution } from "#modules/plugins/packages/schema-evolution";
import type { StoredPlugin } from "#modules/plugins/packages/types";
import { resolvePluginUserSettings } from "#modules/plugins/preferences/user-settings";
import {
	isEntityBrowserRenderer,
	validateSavedViewDefinition,
} from "#modules/saved-views/definition-validation";
import { DatabaseSession } from "#platform/db/session";

import { archiveError } from "../archive/error";
import {
	collectReferencedPluginKeys,
	importQueryPluginReferences,
	importRendererSettings,
	rewriteEventReferences,
	rewriteRelationshipReferences,
} from "../archive/references";
import {
	ArchiveCalendarSourceOverride,
	ArchiveEntityDependency,
	type ArchiveEntitySnapshot,
	ArchiveEvent,
	ArchiveFoldValue,
	type ArchiveInstallation,
	ArchiveIntegration,
	ArchiveNotificationSubscription,
	archivePluginDefinitionContract,
	ArchivePublication,
	type ArchiveRecords,
	ArchiveRelationship,
	ArchiveReminder,
	ArchiveRequiredPlugin,
	ArchiveSavedView,
	type ArchiveSavedViewReference,
	ArchiveUserEntity,
	decodeArchiveJsonObject,
	isArchiveJsonObject,
} from "../archive/schemas";
import {
	type ArchiveMetadata,
	type ArchiveSectionReader,
	type ArchiveSections,
	STREAMED_SECTION_PATHS,
	type StreamedSectionPath,
} from "../archive/sections";
import { BACKUP_STAGE_BATCH_SIZE, BACKUP_STAGE_PAGE_BYTES, BackupStaging } from "../staging";
import { BackupRestorePersistence } from "./persistence";

export class RequiredBackupPluginUnavailable extends Schema.TaggedError<
	RequiredBackupPluginUnavailable,
	{ readonly brand: unique symbol }
>()("RequiredBackupPluginUnavailable", {
	requiredVersion: Schema.String,
	packageId: ArchiveRequiredPlugin.fields.packageId,
}) {}

const archiveReferenceError = (error: DataReferenceError) =>
	archiveError(error.code, error.message);

const assetForbidden = () => new BackupBadRequest({ reason: { code: "asset-forbidden" } });

const unavailable = (plugin: ArchiveRequiredPlugin) =>
	new RequiredBackupPluginUnavailable({
		packageId: plugin.packageId,
		requiredVersion: plugin.version,
	});

const archivedManifest = (target: StoredPlugin, plugin: ArchiveRequiredPlugin) => ({
	...target.manifest,
	...plugin.definitionContract,
});

const notSystemOwned =
	(systemIds: ReadonlySet<string>) =>
	({ pluginId }: { readonly pluginId: null | string }) =>
		pluginId === null || !systemIds.has(pluginId);

const mappedPluginId = Effect.fn(function* (
	pluginIdByKey: ReadonlyMap<string, string>,
	key: null | string,
) {
	if (key === null) {
		return null;
	}
	const pluginId = pluginIdByKey.get(key);
	return pluginId ?? (yield* badRequest(`Backup references unmapped plugin key '${key}'`));
});

const mappedOwner = (pluginIdByKey: ReadonlyMap<string, string>, key: null | string) =>
	Effect.map(mappedPluginId(pluginIdByKey, key), definitionOwner);

export const resolveRequiredPluginIds = Effect.fn(function* (
	required: ReadonlyArray<ArchiveRequiredPlugin>,
	installedPlugins: ReadonlyArray<StoredPlugin>,
) {
	const installed = new Map(
		installedPlugins
			.filter((plugin) => plugin.scope === "system")
			.map((plugin) => [plugin.manifest.metadata.packageId, plugin]),
	);
	const pluginIdByKey = new Map<string, string>();
	for (const plugin of required) {
		const key = pluginPackageKey({ scope: "system", packageId: plugin.packageId });
		const target = installed.get(plugin.packageId);
		if (
			!target ||
			pluginIdByKey.has(key) ||
			(target.contentHash === plugin.contentHash &&
				stableStringify(plugin.definitionContract) !==
					stableStringify(archivePluginDefinitionContract(target.manifest)))
		) {
			return yield* unavailable(plugin);
		}
		yield* Effect.try({
			catch: () => unavailable(plugin),
			try: () =>
				buildDefinitionSnapshot(
					mergeManifestDefinitions(
						{
							savedViews: [],
							entitySchemas: [],
							signalSchemas: [],
							calendarSources: [],
							relationshipSchemas: [],
						},
						[{ id: target.id, manifest: archivedManifest(target, plugin) }],
					),
				),
		});
		yield* validateAdditiveSchemaEvolution(archivedManifest(target, plugin), target.manifest).pipe(
			Effect.mapError(() => unavailable(plugin)),
		);
		pluginIdByKey.set(key, target.id);
	}
	return pluginIdByKey;
});

const parseDate = (value: string) => new Date(value);

const decodePointerSegment = (value: string) => value.replaceAll("~1", "/").replaceAll("~0", "~");

const isRequiredSecretPath = (path: string, schema: AppSchema) => {
	const segments = path.startsWith("/") ? path.slice(1).split("/").map(decodePointerSegment) : [];
	let definition: undefined | AppPropertyDefinition = segments[0]
		? schema.fields[segments[0]]
		: undefined;
	for (const segment of segments.slice(1)) {
		if (definition?.type === "object") {
			definition = definition.properties[segment];
		} else if (definition?.type === "array" && /^\d+$/.test(segment)) {
			definition = definition.items;
		} else {
			return false;
		}
	}
	return definition?.secret === true && definition.validation?.required === true;
};

export const resolveRestoredInstallationLifecycle = (
	state: Pick<
		ArchiveInstallation,
		| "hiddenIntent"
		| "healthReason"
		| "lifecycleIntent"
		| "configuredSecretPaths"
		| "incompatibilityReason"
	>,
	schema: AppSchema,
	redactedConfigNeedsConfiguration: boolean,
	systemIdentityConflict: boolean,
) => {
	if (systemIdentityConflict || state.lifecycleIntent === "incompatible") {
		return {
			isHidden: state.hiddenIntent,
			health: "incompatible" as const,
			incompatibilityReason: systemIdentityConflict
				? ("package-identity-conflict" as const)
				: state.incompatibilityReason,
			healthReason: systemIdentityConflict
				? "The package identity is reserved by an active system plugin"
				: state.healthReason,
		};
	}
	const missingRequiredSecret =
		state.lifecycleIntent === "needs-configuration" ||
		redactedConfigNeedsConfiguration ||
		state.configuredSecretPaths.some((path) => isRequiredSecretPath(path, schema));
	return {
		healthReason: null,
		incompatibilityReason: null,
		isHidden: missingRequiredSecret ? true : state.hiddenIntent,
		health: missingRequiredSecret ? ("needs-configuration" as const) : ("ready" as const),
	};
};

export const resolveRestoredIntegrationDisabled = (
	integration: {
		readonly isDisabled: boolean;
		readonly configuredSecretPaths: ReadonlyArray<string>;
	},
	schema: AppSchema,
) =>
	integration.isDisabled ||
	Object.values(schema.fields).some(
		(definition) => definition.type === "string" && definition.format?.kind === "oauth-connection",
	) ||
	integration.configuredSecretPaths.some((path) => isRequiredSecretPath(path, schema));

const validateProperties = (properties: unknown, propertiesSchema: AppSchema, kind: string) =>
	parseAppSchemaProperties({ kind, properties, propertiesSchema }).pipe(
		Effect.mapError((error) => badRequest(error.message)),
	);

const emptyPluginUserSettingsSchema: AppSchema = { fields: {}, unknownKeys: "strict" };

type ArchivePropertyReference = {
	readonly id: string;
	readonly required: boolean;
	readonly kind: "event-id" | "entity-id" | "relationship-id";
};

const collectPropertyReferences = (properties: unknown, schema: AppSchema) => {
	const references: ArchivePropertyReference[] = [];
	const visit = (definition: AppPropertyDefinition, value: unknown) => {
		if (definition.type === "string" && definition.reference && typeof value === "string") {
			references.push({
				id: value,
				kind: definition.reference.kind,
				required: definition.reference.required === true,
			});
			return;
		}
		if (definition.type === "object" && isArchiveJsonObject(value)) {
			for (const [key, child] of Object.entries(definition.properties)) {
				visit(child, value[key]);
			}
			return;
		}
		if (definition.type === "array" && Array.isArray(value)) {
			for (const item of value) {
				visit(definition.items, item);
			}
		}
	};
	if (isArchiveJsonObject(properties)) {
		for (const [key, definition] of Object.entries(schema.fields)) {
			visit(definition, properties[key]);
		}
	}
	return references;
};

const referenceNamespace = (kind: ArchivePropertyReference["kind"]) => {
	if (kind === "entity-id") {
		return "entity";
	}
	if (kind === "relationship-id") {
		return "relationship";
	}
	return "event";
};

const emptyArchiveRecords = (
	metadata: ArchiveMetadata,
	sectionRecords: Partial<
		Pick<
			ArchiveRecords,
			| "entities"
			| "reminders"
			| "savedViews"
			| "integrations"
			| "publications"
			| "relationships"
			| "entityDependencies"
			| "calendarSourceOverrides"
			| "notificationSubscriptions"
		>
	> = {},
): ArchiveRecords => ({
	...metadata,
	entities: [],
	reminders: [],
	foldValues: [],
	savedViews: [],
	integrations: [],
	publications: [],
	relationships: [],
	entityDependencies: [],
	calendarSourceOverrides: [],
	notificationSubscriptions: [],
	...sectionRecords,
});

const archiveSectionNamespaces = {
	"events.ndjson": "event",
	"entities.ndjson": "entity",
	"reminders.ndjson": "reminder",
	"fold-values.ndjson": "fold-value",
	"saved-views.ndjson": "saved-view",
	"integrations.ndjson": "integration",
	"publications.ndjson": "publication",
	"relationships.ndjson": "relationship",
	"entity-dependencies.ndjson": "entity",
	"calendar-source-overrides.ndjson": "calendar",
	"notification-subscriptions.ndjson": "subscription",
} satisfies Record<StreamedSectionPath, string>;

const archiveSectionNamespace = (path: StreamedSectionPath) => archiveSectionNamespaces[path];

const sectionRecordId = (path: StreamedSectionPath, value: unknown) => {
	if (!isArchiveJsonObject(value)) {
		return "";
	}
	if (path === "calendar-source-overrides.ndjson") {
		return JSON.stringify([value["pluginKey"], value["slug"]]);
	}
	if (path === "notification-subscriptions.ndjson") {
		return JSON.stringify([value["signalSchemaPluginKey"], value["signalSchemaSlug"]]);
	}
	if (path === "fold-values.ndjson") {
		return typeof value["entityId"] === "string" ? value["entityId"] : "";
	}
	return typeof value["id"] === "string" ? value["id"] : "";
};

const encodeStagedValue = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

// A fold value is the plugin's own, so anything in it could be an archived ID, alone or as part of a key.
const foldValueTokens = (value: unknown, tokens = new Set<string>()) => {
	if (typeof value === "string") {
		for (const token of value.split(":")) {
			tokens.add(token);
		}
	} else if (typeof value === "object" && value !== null) {
		for (const item of Object.values(value)) {
			foldValueTokens(item, tokens);
		}
	}
	return tokens;
};

const validateIntegrationSettings = (
	integration: ArchiveRecords["integrations"][number],
	properties: Record<string, unknown>,
	propertiesSchema: AppSchema,
) =>
	parseAppSchemaProperties({
		properties,
		propertiesSchema,
		kind: "Integration settings",
		allowedMissingRequiredPaths: integration.configuredSecretPaths.map((path) =>
			path.slice(1).split("/").map(decodePointerSegment),
		),
	}).pipe(Effect.mapError((error) => badRequest(error.message)));

export const resolveRestoredPluginUserSettings = Effect.fn(function* (
	userSettings: Record<string, unknown>,
	settingsSchema: AppSchema | undefined,
) {
	return yield* resolvePluginUserSettings(
		settingsSchema ?? emptyPluginUserSettingsSchema,
		userSettings,
	).pipe(Effect.mapError((error) => badRequest(error.message)));
});

const bootstrapSchemaIdentity = (entitySchemaSlug: string, entitySchemaPluginId: null | string) =>
	JSON.stringify([entitySchemaSlug, entitySchemaPluginId]);

type TargetBootstrapEntity = Pick<
	PortableEntityRecord,
	"id" | "provider" | "externalId" | "entitySchemaSlug" | "entitySchemaPluginId"
>;
type ArchivedBootstrapEntity = Pick<
	ArchiveRecords["entities"][number],
	"id" | "provider" | "externalId" | "entitySchemaSlug" | "entitySchemaPluginKey"
>;

const isBootstrapEntity = (entity: {
	readonly provider: unknown;
	readonly externalId: null | string;
}) => entity.provider === null && entity.externalId === null;

export const resolveBootstrapEntityMappings = Effect.fn(function* (
	archived: ReadonlyArray<ArchivedBootstrapEntity>,
	target: ReadonlyArray<TargetBootstrapEntity>,
	pluginIdByKey: ReadonlyMap<string, string>,
) {
	const archivedByIdentity = new Map<string, Array<ArchivedBootstrapEntity>>();
	for (const entity of archived) {
		if (!isBootstrapEntity(entity)) {
			continue;
		}
		const entitySchemaPluginKey = entity.entitySchemaPluginKey;
		let entitySchemaPluginId: null | string = null;
		if (entitySchemaPluginKey !== null) {
			const resolved = pluginIdByKey.get(entitySchemaPluginKey);
			if (!resolved) {
				return yield* badRequest(
					`Backup references unmapped plugin key '${entitySchemaPluginKey}'`,
				);
			}
			entitySchemaPluginId = resolved;
		}
		const identity = bootstrapSchemaIdentity(entity.entitySchemaSlug, entitySchemaPluginId);
		const matching = archivedByIdentity.get(identity);
		if (matching) {
			matching.push(entity);
		} else {
			archivedByIdentity.set(identity, [entity]);
		}
	}
	const targetByIdentity = new Map<string, Array<TargetBootstrapEntity>>();
	for (const entity of target) {
		if (!isBootstrapEntity(entity)) {
			continue;
		}
		const identity = bootstrapSchemaIdentity(entity.entitySchemaSlug, entity.entitySchemaPluginId);
		const matching = targetByIdentity.get(identity);
		if (matching) {
			matching.push(entity);
		} else {
			targetByIdentity.set(identity, [entity]);
		}
	}
	const mappings = new Map<string, EntityId>();
	for (const [identity, archivedEntities] of archivedByIdentity) {
		const targetEntities = targetByIdentity.get(identity);
		if (!targetEntities) {
			continue;
		}
		const archivedEntity = archivedEntities[0];
		const targetEntity = targetEntities[0];
		if (archivedEntities.length !== 1 || targetEntities.length !== 1) {
			return yield* badRequest("Backup bootstrap entity identity is ambiguous");
		}
		if (!archivedEntity || !targetEntity) {
			return yield* badRequest("Backup bootstrap entity mapping is unavailable");
		}
		mappings.set(archivedEntity.id, EntityId.make(targetEntity.id));
	}
	return mappings;
});

export const assertDependencySchemaOwnership = Effect.fn(function* (
	dependency: ArchiveEntityDependency,
	schemaPluginKey: null | string,
) {
	if (
		(dependency.identity.kind === "provider" || dependency.identity.kind === "bootstrap") &&
		schemaPluginKey !== dependency.identity.pluginKey
	) {
		return yield* badRequest("Backup global dependency schema is not owned by its plugin");
	}
	if (
		dependency.identity.kind === "provider" &&
		(dependency.provider === null ||
			dependency.provider.pluginKey !== dependency.identity.pluginKey ||
			dependency.provider.providerSlug !== dependency.identity.providerSlug)
	) {
		return yield* badRequest("Backup provider dependency provenance is inconsistent");
	}
	if (
		dependency.identity.kind === "bootstrap" &&
		(dependency.provider !== null ||
			dependency.externalId !== dependency.identity.externalId ||
			dependency.entitySchemaSlug !== dependency.identity.entitySchemaSlug)
	) {
		return yield* badRequest("Backup bootstrap dependency identity is inconsistent");
	}
	if (dependency.identity.kind === "unmanaged" && dependency.provider !== null) {
		return yield* badRequest("Backup unmanaged dependency has provider provenance");
	}
	return yield* Effect.void;
});

export const selectTranslationsForRestore = (
	inserted: boolean,
	translations: ArchiveEntitySnapshot["translations"],
) => (inserted ? translations : []);

type ArchiveEntityIdentity = {
	readonly id: string;
	readonly entitySchemaSlug: string;
	readonly entitySchemaPluginKey: null | string;
};

export const preflightProvenance = Effect.fn(function* (
	records: ArchiveRecords,
	archivedEvents: ArchiveSectionReader<ArchiveEvent>,
	pluginIdByKey: ReadonlyMap<string, string>,
	definitions: DefinitionSnapshot,
	requiredPlugins: ReadonlyArray<ArchiveRequiredPlugin>,
	endpointEntities: ReadonlyMap<string, ArchiveEntityIdentity> = new Map(),
) {
	const privateKeys = new Set(records.privatePlugins.map(({ key }) => key));
	const entitiesById = new Map(
		[...records.entities, ...records.entityDependencies].map((entity) => [entity.id, entity]),
	);
	const definition = (kind: string, slug: string, key: null | string) =>
		Effect.map(mappedOwner(pluginIdByKey, key), (owner) => definitionKey(kind, owner, slug));
	const assertOwner = Effect.fn(function* (
		key: null | string,
		schemaDefinition: undefined | { readonly pluginId?: null | string | undefined },
		kind: string,
	) {
		if (!schemaDefinition) {
			return yield* badRequest(`Backup references an unavailable ${kind}`);
		}
		if ((yield* mappedPluginId(pluginIdByKey, key)) !== (schemaDefinition.pluginId ?? null)) {
			return yield* badRequest(`Backup ${kind} provenance has the wrong plugin owner`);
		}
		return yield* Effect.void;
	});
	const assertArchivedSavedView = Effect.fn(function* (
		reference: ArchiveSavedViewReference,
		kind: string,
	) {
		if (reference.kind === "custom") {
			return yield* Effect.void;
		}
		const key = reference.kind === "plugin" ? reference.pluginKey : null;
		return yield* assertOwner(
			key,
			definitions.savedViews[yield* definition("saved-view", reference.slug, key)],
			kind,
		);
	});
	const contracts = new Map([
		...records.privatePlugins.map((plugin) => [plugin.key, plugin.manifest] as const),
		...requiredPlugins.map(
			(plugin) =>
				[
					pluginPackageKey({ scope: "system", packageId: plugin.packageId }),
					plugin.definitionContract,
				] as const,
		),
	]);
	for (const plugin of records.privatePlugins) {
		for (const imported of plugin.compiledClient?.imports ?? []) {
			const key = pluginPackageKey(imported.reference);
			yield* mappedPluginId(pluginIdByKey, key);
			if (!contracts.get(key)?.client?.exports?.[imported.exportName]) {
				return yield* badRequest("Backup client dependency references an unavailable export");
			}
		}
	}
	const assertProvider = Effect.fn(function* (
		provider: null | { readonly pluginKey: string; readonly providerSlug: string },
		schemaKey: null | string,
		schemaSlug: string,
	) {
		if (provider) {
			yield* mappedPluginId(pluginIdByKey, provider.pluginKey);
			if (
				provider.pluginKey !== schemaKey ||
				!contracts
					.get(provider.pluginKey)
					?.providers.some(({ slug }) => slug === provider.providerSlug)
			) {
				return yield* badRequest(
					`Backup provider provenance is not declared by the owner of '${schemaSlug}'`,
				);
			}
		}
		return yield* Effect.void;
	});

	for (const installation of records.installations) {
		yield* mappedPluginId(pluginIdByKey, installation.packageKey);
		const privatePlugin = records.privatePlugins.find(({ key }) => key === installation.packageKey);
		if (privatePlugin) {
			yield* validateRestoredProperties(
				installation.config,
				privatePlugin.manifest.configSchema,
				installation.configuredSecretPaths,
				installation.lifecycleIntent === "needs-configuration" ||
					installation.lifecycleIntent === "incompatible",
			).pipe(Effect.mapError((error) => badRequest(error.message)));
		}
		yield* resolveRestoredPluginUserSettings(
			installation.userSettings,
			contracts.get(installation.packageKey)?.userSettingsSchema,
		);
		if (installation.homeSavedView) {
			yield* assertArchivedSavedView(installation.homeSavedView, "home saved view");
		}
	}
	for (const integration of records.integrations) {
		if (integration.packageKey !== null) {
			yield* mappedPluginId(pluginIdByKey, integration.packageKey);
		}
		const settingsSchema = resolveIntegrationSettingsSchema(
			integration,
			integration.packageKey === null
				? undefined
				: contracts.get(integration.packageKey)?.integrationProviders,
		);
		if (!settingsSchema) {
			return yield* badRequest("Backup integration provider is not declared by its owner");
		}
		yield* parseAppSchemaProperties({
			kind: "Integration settings",
			propertiesSchema: settingsSchema,
			properties: integration.providerSpecifics,
			allowedMissingRequiredPaths: integration.configuredSecretPaths.map((path) =>
				path.slice(1).split("/").map(decodePointerSegment),
			),
		}).pipe(Effect.mapError((error) => badRequest(error.message)));
	}
	for (const entity of records.entities) {
		const schema =
			definitions.entitySchemas[
				yield* definition("entity", entity.entitySchemaSlug, entity.entitySchemaPluginKey)
			];
		yield* assertOwner(entity.entitySchemaPluginKey, schema, "entity schema");
		yield* assertProvider(entity.provider, entity.entitySchemaPluginKey, entity.entitySchemaSlug);
		if (entity.provider !== null && !privateKeys.has(entity.provider.pluginKey)) {
			return yield* badRequest("Backup user entity cannot use a system provider");
		}
		if (schema) {
			yield* validateProperties(entity.properties, schema.propertiesSchema, "Entity properties");
		}
	}
	for (const dependency of records.entityDependencies) {
		if (
			dependency.entitySchemaPluginKey !== null &&
			privateKeys.has(dependency.entitySchemaPluginKey)
		) {
			return yield* badRequest("Backup private entity cannot request global scope");
		}
		const schema =
			definitions.entitySchemas[
				yield* definition("entity", dependency.entitySchemaSlug, dependency.entitySchemaPluginKey)
			];
		yield* assertOwner(dependency.entitySchemaPluginKey, schema, "entity schema");
		yield* assertProvider(
			dependency.provider,
			dependency.entitySchemaPluginKey,
			dependency.entitySchemaSlug,
		);
		yield* assertDependencySchemaOwnership(dependency, dependency.entitySchemaPluginKey);
		if (
			dependency.kind === "provider-reference" &&
			!contracts
				.get(dependency.identity.pluginKey)
				?.providers.some(
					(provider) =>
						provider.slug === dependency.identity.providerSlug &&
						provider.rootEntitySchemaSlug === dependency.entitySchemaSlug,
				)
		) {
			return yield* badRequest("Backup provider reference does not match its declared root schema");
		}
		if (schema && dependency.kind === "snapshot") {
			yield* validateProperties(
				dependency.properties,
				schema.propertiesSchema,
				"Entity properties",
			);
			for (const translation of dependency.translations) {
				if (translation.properties !== null) {
					yield* validateProperties(
						translation.properties,
						schema.propertiesSchema,
						"Translation properties",
					);
				}
			}
		}
		if (dependency.identity.kind !== "unmanaged") {
			yield* mappedPluginId(pluginIdByKey, dependency.identity.pluginKey);
		}
	}
	for (const relationship of records.relationships) {
		if (relationship.scope !== "user") {
			return yield* badRequest("Backup relationship cannot request global scope");
		}
		const schema =
			definitions.relationshipSchemas[
				yield* definition(
					"relationship",
					relationship.relationshipSchemaSlug,
					relationship.relationshipSchemaPluginKey,
				)
			];
		yield* assertOwner(relationship.relationshipSchemaPluginKey, schema, "relationship schema");
		if (schema) {
			yield* validateProperties(
				relationship.properties,
				schema.propertiesSchema,
				"Relationship properties",
			);
			for (const [id, slug] of [
				[relationship.sourceEntityId, schema.sourceEntitySchemaSlug],
				[relationship.targetEntityId, schema.targetEntitySchemaSlug],
			] as const) {
				const endpoint = entitiesById.get(id) ?? endpointEntities.get(id);
				if (!endpoint) {
					return yield* badRequest("Backup relationship references an unknown entity");
				}
				if (
					(relationship.relationshipSchemaPluginKey !== null || slug !== null) &&
					endpoint.entitySchemaPluginKey !== relationship.relationshipSchemaPluginKey
				) {
					return yield* badRequest("Backup relationship endpoint has the wrong schema owner");
				}
				if (slug !== null && endpoint.entitySchemaSlug !== slug) {
					return yield* badRequest("Backup relationship endpoint has the wrong entity schema");
				}
			}
		}
	}
	for (const override of records.calendarSourceOverrides) {
		yield* assertOwner(
			override.pluginKey,
			definitions.calendarSources[
				yield* definition("calendar-source", override.slug, override.pluginKey)
			],
			"calendar source",
		);
	}
	const userEntitiesById = new Map(records.entities.map((entity) => [entity.id, entity]));
	for (const { source } of records.publications) {
		if (source.kind === "collection") {
			const collection =
				userEntitiesById.get(source.collectionId) ?? endpointEntities.get(source.collectionId);
			if (
				collection?.entitySchemaSlug !== "collection" ||
				collection.entitySchemaPluginKey !== null
			) {
				return yield* badRequest("Backup publication references an unavailable collection");
			}
		} else {
			yield* assertArchivedSavedView(source.reference, "publication saved view");
		}
	}
	for (const view of records.savedViews) {
		if (view.kind === "builtin-override") {
			yield* assertOwner(
				view.pluginKey,
				definitions.savedViews[yield* definition("saved-view", view.slug, view.pluginKey)],
				"saved view",
			);
		} else {
			if (view.pluginKey !== null) {
				yield* mappedPluginId(pluginIdByKey, view.pluginKey);
			}
			const dataSources = yield* importQueryPluginReferences(view.dataSources, pluginIdByKey);
			const settings = yield* importRendererSettings(view.renderer, view.settings, pluginIdByKey);
			if (isEntityBrowserRenderer(view.renderer)) {
				const decoded = yield* Schema.decodeUnknownEffect(EntityBrowserSavedViewSettings)(
					settings,
				).pipe(Effect.mapError((error) => badRequest(error.message)));
				const schemas = [
					...decoded.subject.schemas,
					...(decoded.addAction?.type === "provider-search" ? [decoded.addAction.schema] : []),
				];
				if (
					schemas.some(
						({ slug, owner }) => !definitions.entitySchemas[definitionKey("entity", owner, slug)],
					)
				) {
					return yield* badRequest("Backup renderer references an unavailable entity schema");
				}
			}
			const renderer: SavedViewRenderer =
				view.renderer.kind === "plugin"
					? {
							kind: "plugin",
							exportName: view.renderer.exportName,
							pluginId:
								(yield* mappedPluginId(pluginIdByKey, view.renderer.pluginKey)) ??
								(yield* badRequest("Backup renderer owner is unavailable")),
						}
					: view.renderer;
			const page =
				view.renderer.kind === "plugin"
					? contracts.get(view.renderer.pluginKey)?.client?.exports?.[view.renderer.exportName]
					: undefined;
			yield* validateSavedViewDefinition(
				renderer,
				settings,
				dataSources,
				page?.kind === "page" ? page : null,
			).pipe(Effect.mapError(() => badRequest("Backup saved view definition is invalid")));
		}
	}
	for (const subscription of records.notificationSubscriptions) {
		const schema =
			definitions.signalSchemas[
				yield* definition(
					"signal",
					subscription.signalSchemaSlug,
					subscription.signalSchemaPluginKey,
				)
			];
		yield* assertOwner(subscription.signalSchemaPluginKey, schema, "signal schema");
		if (schema && isArchiveJsonObject(subscription.metadata)) {
			yield* validateProperties(
				subscription.metadata,
				schema.propertiesSchema,
				"Notification metadata",
			);
		}
	}
	const entitySchemaById = new Map<string, string>();
	for (const { id, entitySchemaSlug, entitySchemaPluginKey } of [
		...entitiesById.values(),
		...endpointEntities.values(),
	]) {
		entitySchemaById.set(id, yield* definition("entity", entitySchemaSlug, entitySchemaPluginKey));
	}
	yield* Stream.runForEach(archivedEvents.read(), (event) =>
		Effect.gen(function* () {
			if (
				(event.sessionEntityId !== null &&
					!entitiesById.has(event.sessionEntityId) &&
					!endpointEntities.has(event.sessionEntityId)) ||
				(!entitiesById.has(event.entityId) && !endpointEntities.has(event.entityId))
			) {
				return yield* badRequest("Backup event session references an unknown entity");
			}
			const schemaKey = entitySchemaById.get(event.entityId);
			const eventDefinition = schemaKey
				? definitions.entitySchemas[schemaKey]?.eventSchemas[event.eventSchemaSlug]
				: undefined;
			yield* assertOwner(event.eventSchemaPluginKey, eventDefinition, "event schema");
			if (eventDefinition) {
				yield* validateProperties(
					event.properties,
					eventDefinition.propertiesSchema,
					"Event properties",
				);
			}
			return yield* Effect.void;
		}),
	);
	return yield* Effect.void;
});

type DependencyTarget = { readonly id: EntityId; readonly inserted: boolean };

const restoredSavedViewReference = Effect.fn(function* (
	reference: ArchiveSavedViewReference,
	pluginIdByKey: ReadonlyMap<string, string>,
	customViewIds: ReadonlyMap<string, string>,
	kind: string,
) {
	if (reference.kind === "custom") {
		const savedViewId = customViewIds.get(reference.savedViewId);
		return savedViewId
			? ({ kind: reference.kind, savedViewId: SavedViewId.make(savedViewId) } as const)
			: yield* badRequest(`Backup ${kind} mapping is incomplete`);
	}
	return builtinSavedViewReference(
		yield* mappedPluginId(pluginIdByKey, reference.kind === "plugin" ? reference.pluginKey : null),
		reference.slug,
	);
});

const restoredPublicationSource = Effect.fn(function* (
	source: ArchivePublication["source"],
	pluginIdByKey: ReadonlyMap<string, string>,
	context: Pick<RestoreRecordBatchContext, "entityIdMap" | "customViewIds">,
) {
	if (source.kind === "collection") {
		const collectionId = context.entityIdMap.get(source.collectionId);
		return collectionId
			? { collectionId, kind: source.kind }
			: yield* badRequest("Backup publication collection mapping is incomplete");
	}
	return {
		kind: source.kind,
		reference: yield* restoredSavedViewReference(
			source.reference,
			pluginIdByKey,
			context.customViewIds,
			"publication saved view",
		),
	};
});

type RestoreRecordBatchContext = {
	readonly eventIdMap: ReadonlyMap<string, string>;
	readonly reminderIds: ReadonlyMap<string, string>;
	readonly entityIdMap: ReadonlyMap<string, EntityId>;
	readonly relationshipIdMap: ReadonlyMap<string, string>;
	readonly customViewIds: ReadonlyMap<string, SavedViewId>;
	readonly bootstrapMappings: ReadonlyMap<string, EntityId>;
	readonly installationIdByKey: ReadonlyMap<string, string>;
	readonly dependencyTargets: ReadonlyMap<string, DependencyTarget>;
	readonly entitySchemaById: ReadonlyMap<EntityId, EntitySchemaSlug>;
};

export class BackupRestoreWriter extends Context.Service<BackupRestoreWriter>()(
	"@ryot-app/kernel-backend/modules/backups/restore/writer/BackupRestoreWriter",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const newUuid = (yield* SecureRandom.SecureRandom).uuidV4();
			const assetReferences = yield* ManagedAssetReferenceLocker.make;
			const persistence = yield* BackupRestorePersistence;
			const staging = yield* BackupStaging;
			const plugins = yield* PluginRepository;
			const entities = yield* EntitiesRepository;
			const groups = yield* EventGroupConstraints.make;
			const admission = yield* AccountAdmission.make;

			const assertRequiredPlugins = Effect.fn("BackupRestoreWriter.assertRequiredPlugins")(
				function* (required: ReadonlyArray<ArchiveRequiredPlugin>) {
					return yield* resolveRequiredPluginIds(
						required,
						yield* plugins.listActiveSystemPlugins(),
					);
				},
			);

			const preflight = Effect.fn("BackupRestoreWriter.preflight")(function* (
				records: ArchiveRecords,
				archivedEvents: ArchiveSectionReader<ArchiveEvent>,
				pluginIdByKey: ReadonlyMap<string, string>,
				definitions: DefinitionSnapshot,
				required: ReadonlyArray<ArchiveRequiredPlugin>,
				endpointEntities: ReadonlyMap<string, ArchiveEntityIdentity> = new Map(),
			) {
				const system = new Map(
					(yield* plugins.listActiveSystemPlugins()).map((plugin) => [
						plugin.manifest.metadata.packageId,
						plugin,
					]),
				);
				const currentContracts: ArchiveRequiredPlugin[] = [];
				const archivedCandidates: Array<Parameters<typeof mergeManifestDefinitions>[1][number]> =
					[];
				const systemIds = new Set<string>();
				for (const plugin of required) {
					const target = system.get(plugin.packageId);
					if (
						!target ||
						pluginIdByKey.get(
							pluginPackageKey({ scope: "system", packageId: plugin.packageId }),
						) !== target.id
					) {
						return yield* unavailable(plugin);
					}
					currentContracts.push({
						...plugin,
						definitionContract: archivePluginDefinitionContract(target.manifest),
					});
					systemIds.add(target.id);
					archivedCandidates.push({ id: target.id, manifest: archivedManifest(target, plugin) });
				}
				const source = definitionSourceFromSnapshot(definitions);
				const archivedDefinitions = yield* Effect.try({
					catch: (error) => badRequest(String(error)),
					try: () =>
						buildDefinitionSnapshot(
							mergeManifestDefinitions(
								{
									savedViews: source.savedViews.filter(notSystemOwned(systemIds)),
									entitySchemas: source.entitySchemas.filter(notSystemOwned(systemIds)),
									signalSchemas: source.signalSchemas.filter(notSystemOwned(systemIds)),
									calendarSources: source.calendarSources.filter(notSystemOwned(systemIds)),
									relationshipSchemas: source.relationshipSchemas.filter(notSystemOwned(systemIds)),
								},
								archivedCandidates,
							),
						),
				});
				for (const key of collectReferencedPluginKeys(records)) {
					if (!pluginIdByKey.has(key)) {
						return yield* badRequest(`Backup references undeclared plugin key '${key}'`);
					}
				}
				yield* preflightProvenance(
					records,
					archivedEvents,
					pluginIdByKey,
					archivedDefinitions,
					required,
					endpointEntities,
				);
				return yield* preflightProvenance(
					records,
					archivedEvents,
					pluginIdByKey,
					definitions,
					currentContracts,
					endpointEntities,
				);
			});

			const emptyEvents: ArchiveSectionReader<ArchiveEvent> = {
				count: 0,
				sha256: "",
				read: () => Stream.empty,
			};

			const forEachStagePage = Effect.fn("BackupRestoreWriter.forEachStagePage")(function* <E, R>(
				runId: BackupRunId,
				path: StreamedSectionPath,
				visit: (
					rows: Effect.Success<ReturnType<typeof staging.listRecords>>,
				) => Effect.Effect<void, E, R>,
			) {
				let afterId: string | undefined;
				let hasNextPage = true;
				while (hasNextPage) {
					const rows = yield* staging.listRecords(runId, path, afterId);
					hasNextPage = rows.length > 0;
					if (hasNextPage) {
						yield* visit(rows);
						afterId = rows[rows.length - 1]?.id;
					}
				}
			});

			const stageArchive = Effect.fn("BackupRestoreWriter.stageArchive")(function* (
				runId: BackupRunId,
				metadata: ArchiveMetadata,
				sections: ArchiveSections,
				pluginIdByKey: ReadonlyMap<string, string>,
				definitions: DefinitionSnapshot,
			) {
				yield* staging.putRecords(
					runId,
					"installation",
					"installations.ndjson",
					metadata.installations.map((value) => ({ value, id: value.packageKey })),
				);
				const writeSection = (path: StreamedSectionPath, reader: ArchiveSectionReader<unknown>) =>
					Effect.gen(function* () {
						const namespace = archiveSectionNamespace(path);
						let batch: Array<{ readonly id: string; readonly value: unknown }> = [];
						let batchBytes = 0;
						let auxiliaryBatch: Array<{ readonly id: string; readonly value: unknown }> = [];
						let customViewBatch: Array<{ readonly id: string; readonly value: unknown }> = [];
						let dependencyIdentityBatch: Array<{ readonly id: string; readonly value: unknown }> =
							[];
						const flush = Effect.gen(function* () {
							if (batch.length > 0) {
								yield* staging.putRecords(runId, namespace, path, batch);
								batch = [];
								batchBytes = 0;
							}
							if (auxiliaryBatch.length > 0) {
								yield* staging.putRecords(
									runId,
									path === "saved-views.ndjson" ? "saved-view-slug" : "entity-translation",
									"auxiliary",
									auxiliaryBatch,
								);
								auxiliaryBatch = [];
							}
							if (customViewBatch.length > 0) {
								yield* staging.putRecords(runId, "saved-view-custom", "auxiliary", customViewBatch);
								customViewBatch = [];
							}
							if (dependencyIdentityBatch.length > 0) {
								yield* staging.putRecords(
									runId,
									"dependency-identity",
									"auxiliary",
									dependencyIdentityBatch,
								);
								dependencyIdentityBatch = [];
							}
						});
						yield* Stream.runForEach(reader.read(), (value) =>
							Effect.gen(function* () {
								const id = sectionRecordId(path, value);
								if (id.length === 0) {
									return yield* archiveError(
										"invalid_entry",
										"Backup record identity is invalid",
										path,
									);
								}
								const valueBytes = new TextEncoder().encode(
									yield* encodeStagedValue(value),
								).byteLength;
								if (batchBytes + valueBytes > BACKUP_STAGE_PAGE_BYTES) {
									yield* flush;
								}
								batch.push({ id, value });
								batchBytes += valueBytes;
								if (path === "saved-views.ndjson" && isArchiveJsonObject(value)) {
									const kind = value["kind"];
									const slug = value["slug"];
									const owner = value["pluginKey"];
									if (
										(kind === "custom" || kind === "builtin-override") &&
										typeof slug === "string" &&
										(owner === null || typeof owner === "string")
									) {
										auxiliaryBatch.push({
											value: { id, kind, slug, owner },
											id: identityTupleKey(kind, owner, slug),
										});
										if (kind === "custom") {
											customViewBatch.push({ id, value });
										}
									}
								}
								if (
									path === "entity-dependencies.ndjson" &&
									isArchiveJsonObject(value) &&
									value["kind"] === "snapshot" &&
									typeof value["id"] === "string" &&
									Array.isArray(value["translations"])
								) {
									for (const translation of value["translations"]) {
										if (
											isArchiveJsonObject(translation) &&
											typeof translation["language"] === "string"
										) {
											auxiliaryBatch.push({
												id: identityTupleKey(value["id"], translation["language"]),
												value: { entityId: value["id"], language: translation["language"] },
											});
										}
									}
								}
								if (path === "entity-dependencies.ndjson") {
									const dependency =
										yield* Schema.decodeUnknownEffect(ArchiveEntityDependency)(value);
									if (dependency.externalId !== null) {
										dependencyIdentityBatch.push({
											value: { id: dependency.id },
											id: identityTupleKey(
												dependency.entitySchemaPluginKey,
												dependency.entitySchemaSlug,
												dependency.provider?.pluginKey ?? null,
												dependency.provider?.providerSlug ?? null,
												dependency.externalId,
											),
										});
									}
								}
								if (batch.length >= BACKUP_STAGE_BATCH_SIZE) {
									yield* flush;
								}
								return yield* Effect.void;
							}),
						);
						yield* flush;
					});
				for (const path of STREAMED_SECTION_PATHS) {
					yield* writeSection(path, sections[path]);
				}
				yield* collectArchiveReferences(runId, metadata, pluginIdByKey, definitions);
				yield* staging.validateReferences(runId);
				return yield* Effect.void;
			});

			const collectArchiveReferences = Effect.fn("BackupRestoreWriter.collectArchiveReferences")(
				function* (
					runId: BackupRunId,
					metadata: ArchiveMetadata,
					pluginIdByKey: ReadonlyMap<string, string>,
					definitions: DefinitionSnapshot,
				) {
					const contracts = new Map(
						metadata.privatePlugins.map((plugin) => [plugin.key, plugin.manifest] as const),
					);
					const candidates: Array<{
						readonly sourceId: string;
						readonly targetId: string;
						readonly required: boolean;
						readonly sourceNamespace: string;
						readonly targetNamespace: string;
					}> = [];
					const add = (
						sourceNamespace: string,
						sourceId: string,
						targetNamespace: string,
						targetId: null | string,
						required = true,
					) => {
						if (targetId !== null) {
							candidates.push({ sourceId, targetId, required, sourceNamespace, targetNamespace });
						}
					};
					const addProperties = (
						sourceNamespace: string,
						sourceId: string,
						properties: unknown,
						propertiesSchema: AppSchema,
					) => {
						if (!isArchiveJsonObject(properties)) {
							return;
						}
						const refs = collectPropertyReferences(properties, propertiesSchema);
						for (const reference of refs) {
							add(
								sourceNamespace,
								sourceId,
								referenceNamespace(reference.kind),
								reference.id,
								reference.required,
							);
						}
					};
					const flushReferences = Effect.fn(function* () {
						const required = candidates.splice(0).filter((reference) => reference.required);
						for (let offset = 0; offset < required.length; offset += BACKUP_STAGE_BATCH_SIZE) {
							const batch = required.slice(offset, offset + BACKUP_STAGE_BATCH_SIZE);
							yield* staging.addReferences(
								runId,
								batch.map(({ required: _required, ...reference }) => reference),
							);
						}
					});
					const forEachReferencePage = <E, R>(
						path: StreamedSectionPath,
						visit: (
							rows: Effect.Success<ReturnType<typeof staging.listRecords>>,
						) => Effect.Effect<void, E, R>,
					) =>
						forEachStagePage(runId, path, (rows) =>
							Effect.gen(function* () {
								yield* visit(rows);
								yield* flushReferences();
							}),
						);
					const entitySchemaFor = (slug: string, key: null | string) => {
						const ownerId = key === null ? null : pluginIdByKey.get(key);
						return ownerId === undefined
							? undefined
							: definitions.entitySchemas[definitionKey("entity", definitionOwner(ownerId), slug)];
					};
					const pluginByKey = new Map<string, { readonly manifest: StoredPlugin["manifest"] }>();
					const systemPlugins = yield* plugins.listActiveSystemPlugins();
					for (const [key, pluginId] of pluginIdByKey) {
						const privatePlugin = metadata.privatePlugins.find((plugin) => plugin.key === key);
						const systemPlugin = systemPlugins.find((plugin) => plugin.id === pluginId);
						if (privatePlugin) {
							pluginByKey.set(key, { manifest: privatePlugin.manifest });
						} else if (systemPlugin) {
							pluginByKey.set(key, { manifest: systemPlugin.manifest });
						}
					}
					for (const [key, plugin] of pluginByKey) {
						contracts.set(key, plugin.manifest);
					}
					for (const installation of metadata.installations) {
						const plugin = pluginByKey.get(installation.packageKey)?.manifest;
						if (plugin) {
							addProperties(
								"installation",
								installation.packageKey,
								installation.config,
								plugin.configSchema,
							);
							if (plugin.userSettingsSchema) {
								addProperties(
									"installation",
									installation.packageKey,
									installation.userSettings,
									plugin.userSettingsSchema,
								);
							}
						}
						if (installation.homeSavedView?.kind === "custom") {
							add(
								"installation",
								installation.packageKey,
								"saved-view-custom",
								installation.homeSavedView.savedViewId,
							);
						}
					}
					yield* flushReferences();

					const entityPage = (value: ArchiveUserEntity | ArchiveEntityDependency) => {
						const schema = entitySchemaFor(value.entitySchemaSlug, value.entitySchemaPluginKey);
						if (!schema) {
							return;
						}
						if ("kind" in value) {
							if (value.kind === "snapshot") {
								addProperties("entity", value.id, value.properties, schema.propertiesSchema);
								for (const translation of value.translations) {
									if (translation.properties !== null) {
										addProperties(
											"entity",
											value.id,
											translation.properties,
											schema.propertiesSchema,
										);
									}
								}
							}
							return;
						}
						addProperties("entity", value.id, value.properties, schema.propertiesSchema);
					};
					for (const path of ["entities.ndjson", "entity-dependencies.ndjson"] as const) {
						yield* forEachReferencePage(path, (rows) =>
							Effect.forEach(
								rows,
								(row) =>
									Effect.gen(function* () {
										if (path === "entities.ndjson") {
											const value = yield* Schema.decodeUnknownEffect(ArchiveUserEntity)(row.value);
											entityPage(value);
										} else {
											const value = yield* Schema.decodeUnknownEffect(ArchiveEntityDependency)(
												row.value,
											);
											entityPage(value);
										}
									}),
								{ discard: true },
							),
						);
					}
					yield* forEachReferencePage("relationships.ndjson", (rows) =>
						Effect.forEach(
							rows,
							(row) =>
								Effect.gen(function* () {
									const value = yield* Schema.decodeUnknownEffect(ArchiveRelationship)(row.value);
									add("relationship", value.id, "entity", value.sourceEntityId);
									add("relationship", value.id, "entity", value.targetEntityId);
									const schema =
										definitions.relationshipSchemas[
											definitionKey(
												"relationship",
												definitionOwner(
													value.relationshipSchemaPluginKey === null
														? null
														: (pluginIdByKey.get(value.relationshipSchemaPluginKey) ?? null),
												),
												value.relationshipSchemaSlug,
											)
										];
									if (schema) {
										addProperties(
											"relationship",
											value.id,
											value.properties,
											schema.propertiesSchema,
										);
									}
								}),
							{ discard: true },
						),
					);
					yield* forEachReferencePage("events.ndjson", (rows) =>
						Effect.gen(function* () {
							const values = yield* Effect.forEach(rows, (row) =>
								Schema.decodeUnknownEffect(ArchiveEvent)(row.value),
							);
							const identities = yield* staging.getEntityIdentities(runId, [
								...new Set(values.map((value) => value.entityId)),
							]);
							const identityById = new Map(identities.map((identity) => [identity.id, identity]));
							for (const event of values) {
								add("event", event.id, "entity", event.entityId);
								add("event", event.id, "entity", event.sessionEntityId);
								const identity = identityById.get(event.entityId);
								const schema = identity
									? entitySchemaFor(identity.entitySchemaSlug, identity.entitySchemaPluginKey)
									: undefined;
								const eventSchema = schema?.eventSchemas[event.eventSchemaSlug];
								if (eventSchema) {
									addProperties("event", event.id, event.properties, eventSchema.propertiesSchema);
								}
							}
						}),
					);
					yield* forEachReferencePage("fold-values.ndjson", (rows) =>
						Effect.forEach(
							rows,
							(row) =>
								Schema.decodeUnknownEffect(ArchiveFoldValue)(row.value).pipe(
									Effect.map((value) =>
										add("fold-value", value.entityId, "entity", value.entityId),
									),
								),
							{ discard: true },
						),
					);
					yield* forEachReferencePage("reminders.ndjson", (rows) =>
						Effect.forEach(
							rows,
							(row) =>
								Effect.gen(function* () {
									const value = yield* Schema.decodeUnknownEffect(ArchiveReminder)(row.value);
									add("reminder", value.id, "entity", value.entityId);
									add("reminder", value.id, "entity", value.parentEntityId);
									add("reminder", value.id, "reminder", value.replacementId);
								}),
							{ discard: true },
						),
					);
					yield* forEachReferencePage("publications.ndjson", (rows) =>
						Effect.forEach(
							rows,
							(row) =>
								Schema.decodeUnknownEffect(ArchivePublication)(row.value).pipe(
									Effect.map(({ id, source }) => {
										if (source.kind === "collection") {
											add("publication", id, "entity", source.collectionId);
										} else if (source.reference.kind === "custom") {
											add("publication", id, "saved-view-custom", source.reference.savedViewId);
										}
									}),
								),
							{ discard: true },
						),
					);
					yield* forEachReferencePage("saved-views.ndjson", (rows) =>
						Effect.forEach(
							rows,
							(row) =>
								Effect.gen(function* () {
									const value = yield* Schema.decodeUnknownEffect(ArchiveSavedView)(row.value);
									if (value.kind === "custom") {
										if (value.pluginKey !== null) {
											add("saved-view", value.id, "installation", value.pluginKey);
										}
										if (value.renderer.kind === "plugin") {
											const client = pluginByKey.get(value.renderer.pluginKey)?.manifest.client;
											const page = client?.exports?.[value.renderer.exportName];
											if (page?.kind === "page") {
												addProperties("saved-view", value.id, value.settings, page.settingsSchema);
											}
										}
									}
								}),
							{ discard: true },
						),
					);
					yield* forEachReferencePage("integrations.ndjson", (rows) =>
						Effect.forEach(
							rows,
							(row) =>
								Effect.gen(function* () {
									const value = yield* Schema.decodeUnknownEffect(ArchiveIntegration)(row.value);
									if (value.packageKey !== null) {
										add("integration", value.id, "installation", value.packageKey);
									}
									const settingsSchema = resolveIntegrationSettingsSchema(
										value,
										value.packageKey === null
											? undefined
											: contracts.get(value.packageKey)?.integrationProviders,
									);
									if (settingsSchema) {
										addProperties("integration", value.id, value.providerSpecifics, settingsSchema);
									}
								}),
							{ discard: true },
						),
					);
					yield* forEachReferencePage("notification-subscriptions.ndjson", (rows) =>
						Effect.forEach(
							rows,
							(row) =>
								Effect.gen(function* () {
									const value = yield* Schema.decodeUnknownEffect(ArchiveNotificationSubscription)(
										row.value,
									);
									const schema =
										definitions.signalSchemas[
											definitionKey(
												"signal",
												definitionOwner(
													value.signalSchemaPluginKey === null
														? null
														: (pluginIdByKey.get(value.signalSchemaPluginKey) ?? null),
												),
												value.signalSchemaSlug,
											)
										];
									if (schema && isArchiveJsonObject(value.metadata)) {
										addProperties(
											"subscription",
											sectionRecordId("notification-subscriptions.ndjson", value),
											value.metadata,
											schema.propertiesSchema,
										);
									}
								}),
							{ discard: true },
						),
					);

					return yield* Effect.void;
				},
			);

			const preflightArchive = Effect.fn("BackupRestoreWriter.preflightArchive")(function* (
				runId: BackupRunId,
				metadata: ArchiveMetadata,
				pluginIdByKey: ReadonlyMap<string, string>,
				definitions: DefinitionSnapshot,
				required: ReadonlyArray<ArchiveRequiredPlugin>,
			) {
				yield* preflight(
					emptyArchiveRecords(metadata),
					emptyEvents,
					pluginIdByKey,
					definitions,
					required,
				);
				for (const path of STREAMED_SECTION_PATHS) {
					yield* forEachStagePage(runId, path, (rows) =>
						Effect.gen(function* () {
							switch (path) {
								case "events.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveEvent)(row.value),
									);
									const ids = [
										...new Set(
											values.flatMap((value) => [
												value.entityId,
												...(value.sessionEntityId === null ? [] : [value.sessionEntityId]),
											]),
										),
									];
									const endpoints = yield* staging.getEntityIdentities(runId, ids);
									const endpointMap = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
									const reader: ArchiveSectionReader<ArchiveEvent> = {
										sha256: "",
										count: values.length,
										read: () => Stream.fromIterable(values),
									};
									yield* preflight(
										emptyArchiveRecords(metadata),
										reader,
										pluginIdByKey,
										definitions,
										required,
										endpointMap,
									);
									break;
								}
								case "entities.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveUserEntity)(row.value),
									);
									yield* preflight(
										emptyArchiveRecords(metadata, { entities: values }),
										emptyEvents,
										pluginIdByKey,
										definitions,
										required,
									);
									break;
								}
								case "reminders.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveReminder)(row.value),
									);
									yield* preflight(
										emptyArchiveRecords(metadata, { reminders: values }),
										emptyEvents,
										pluginIdByKey,
										definitions,
										required,
									);
									break;
								}
								case "saved-views.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveSavedView)(row.value),
									);
									yield* preflight(
										emptyArchiveRecords(metadata, { savedViews: values }),
										emptyEvents,
										pluginIdByKey,
										definitions,
										required,
									);
									break;
								}
								case "fold-values.ndjson": {
									yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveFoldValue)(row.value),
									);
									break;
								}
								case "publications.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchivePublication)(row.value),
									);
									const endpoints = yield* staging.getEntityIdentities(runId, [
										...new Set(
											values.flatMap(({ source }) =>
												source.kind === "collection" ? [source.collectionId] : [],
											),
										),
									]);
									yield* preflight(
										emptyArchiveRecords(metadata, { publications: values }),
										emptyEvents,
										pluginIdByKey,
										definitions,
										required,
										new Map(
											endpoints
												.filter(({ section }) => section === "entities.ndjson")
												.map((endpoint) => [endpoint.id, endpoint]),
										),
									);
									break;
								}
								case "integrations.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveIntegration)(row.value),
									);
									yield* preflight(
										emptyArchiveRecords(metadata, { integrations: values }),
										emptyEvents,
										pluginIdByKey,
										definitions,
										required,
									);
									break;
								}
								case "relationships.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveRelationship)(row.value),
									);
									const ids = [
										...new Set(
											values.flatMap((value) => [value.sourceEntityId, value.targetEntityId]),
										),
									];
									const endpoints = yield* staging.getEntityIdentities(runId, ids);
									const endpointMap = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
									yield* preflight(
										emptyArchiveRecords(metadata, { relationships: values }),
										emptyEvents,
										pluginIdByKey,
										definitions,
										required,
										endpointMap,
									);
									break;
								}
								case "entity-dependencies.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveEntityDependency)(row.value),
									);
									yield* preflight(
										emptyArchiveRecords(metadata, { entityDependencies: values }),
										emptyEvents,
										pluginIdByKey,
										definitions,
										required,
									);
									break;
								}
								case "calendar-source-overrides.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveCalendarSourceOverride)(row.value),
									);
									yield* preflight(
										emptyArchiveRecords(metadata, { calendarSourceOverrides: values }),
										emptyEvents,
										pluginIdByKey,
										definitions,
										required,
									);
									break;
								}
								case "notification-subscriptions.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveNotificationSubscription)(row.value),
									);
									yield* preflight(
										emptyArchiveRecords(metadata, { notificationSubscriptions: values }),
										emptyEvents,
										pluginIdByKey,
										definitions,
										required,
									);
									break;
								}
							}
						}),
					);
				}
			});

			const resolveProvider = Effect.fn("BackupRestoreWriter.resolveProvider")(function* (
				pluginIdByKey: ReadonlyMap<string, string>,
				provider: null | { readonly pluginKey: string; readonly providerSlug: string },
			) {
				if (provider === null) {
					return null;
				}
				const pluginId = pluginIdByKey.get(provider.pluginKey);
				const resolved = pluginId
					? yield* plugins.resolveProviderBySlugs({ pluginId, providerSlug: provider.providerSlug })
					: null;
				return resolved ?? (yield* badRequest("Backup requires an unavailable provider"));
			});

			const buildBatchContext = Effect.fn("BackupRestoreWriter.buildBatchContext")(function* (
				runId: BackupRunId,
				metadata: ArchiveMetadata,
				records: ArchiveRecords,
				events: ReadonlyArray<ArchiveEvent>,
				pluginIdByKey: ReadonlyMap<string, string>,
				definitions: DefinitionSnapshot,
				installationIdByKey: ReadonlyMap<string, string>,
			) {
				const entityIds = new Set<string>();
				const relationshipIds = new Set<string>();
				const eventIds = new Set<string>();
				const savedViewIds = new Set<string>();
				const reminderIds = new Set<string>();
				const addPropertyRefs = (properties: unknown, propertiesSchema: AppSchema | undefined) => {
					if (!propertiesSchema) {
						return;
					}
					for (const reference of collectPropertyReferences(properties, propertiesSchema)) {
						if (reference.kind === "entity-id") {
							entityIds.add(reference.id);
						}
						if (reference.kind === "relationship-id") {
							relationshipIds.add(reference.id);
						}
						if (reference.kind === "event-id") {
							eventIds.add(reference.id);
						}
					}
				};
				const getEntitySchema = (slug: string, key: null | string) => {
					const pluginId = key === null ? null : pluginIdByKey.get(key);
					return pluginId === undefined
						? undefined
						: definitions.entitySchemas[definitionKey("entity", definitionOwner(pluginId), slug)];
				};
				const getRelationshipSchema = (slug: string, key: null | string) => {
					const pluginId = key === null ? null : pluginIdByKey.get(key);
					return pluginId === undefined
						? undefined
						: definitions.relationshipSchemas[
								definitionKey("relationship", definitionOwner(pluginId), slug)
							];
				};
				const contracts = new Map(
					metadata.privatePlugins.map((plugin) => [plugin.key, plugin.manifest] as const),
				);
				const activeSystemPlugins = yield* plugins.listActiveSystemPlugins();
				for (const [key, pluginId] of pluginIdByKey) {
					const system = activeSystemPlugins.find((plugin) => plugin.id === pluginId);
					if (system && !contracts.has(key)) {
						contracts.set(key, system.manifest);
					}
				}
				for (const entity of records.entities) {
					entityIds.add(entity.id);
					addPropertyRefs(
						entity.properties,
						getEntitySchema(entity.entitySchemaSlug, entity.entitySchemaPluginKey)
							?.propertiesSchema,
					);
				}
				for (const dependency of records.entityDependencies) {
					entityIds.add(dependency.id);
					if (dependency.kind === "snapshot") {
						const propertiesSchema = getEntitySchema(
							dependency.entitySchemaSlug,
							dependency.entitySchemaPluginKey,
						)?.propertiesSchema;
						addPropertyRefs(dependency.properties, propertiesSchema);
						for (const translation of dependency.translations) {
							addPropertyRefs(translation.properties, propertiesSchema);
						}
					}
				}
				for (const relationship of records.relationships) {
					relationshipIds.add(relationship.id);
					entityIds.add(relationship.sourceEntityId);
					entityIds.add(relationship.targetEntityId);
					addPropertyRefs(
						relationship.properties,
						getRelationshipSchema(
							relationship.relationshipSchemaSlug,
							relationship.relationshipSchemaPluginKey,
						)?.propertiesSchema,
					);
				}
				for (const reminder of records.reminders) {
					reminderIds.add(reminder.id);
					if (reminder.replacementId !== null) {
						reminderIds.add(reminder.replacementId);
					}
					if (reminder.entityId !== null) {
						entityIds.add(reminder.entityId);
					}
					if (reminder.parentEntityId !== null) {
						entityIds.add(reminder.parentEntityId);
					}
				}
				for (const event of events) {
					entityIds.add(event.entityId);
					if (event.sessionEntityId !== null) {
						entityIds.add(event.sessionEntityId);
					}
				}
				for (const { source } of records.publications) {
					if (source.kind === "collection") {
						entityIds.add(source.collectionId);
					} else if (source.reference.kind === "custom") {
						savedViewIds.add(source.reference.savedViewId);
					}
				}
				const entityIdentityRows = yield* staging.getEntityIdentities(runId, [...entityIds]);
				const entityIdentityById = new Map(
					entityIdentityRows.map((identity) => [identity.id, identity]),
				);
				for (const event of events) {
					const identity = entityIdentityById.get(event.entityId);
					const eventSchema = identity
						? getEntitySchema(identity.entitySchemaSlug, identity.entitySchemaPluginKey)
								?.eventSchemas[event.eventSchemaSlug]
						: undefined;
					addPropertyRefs(event.properties, eventSchema?.propertiesSchema);
				}
				for (const view of records.savedViews) {
					if (view.kind !== "custom") {
						continue;
					}
					savedViewIds.add(view.id);
					if (view.renderer.kind !== "plugin") {
						continue;
					}
					const page = contracts.get(view.renderer.pluginKey)?.client?.exports?.[
						view.renderer.exportName
					];
					if (page?.kind === "page") {
						addPropertyRefs(view.settings, page.settingsSchema);
					}
				}
				for (const integration of records.integrations) {
					const settingsSchema = resolveIntegrationSettingsSchema(
						integration,
						integration.packageKey === null
							? undefined
							: contracts.get(integration.packageKey)?.integrationProviders,
					);
					addPropertyRefs(integration.providerSpecifics, settingsSchema);
				}
				for (const subscription of records.notificationSubscriptions) {
					const pluginId =
						subscription.signalSchemaPluginKey === null
							? null
							: (pluginIdByKey.get(subscription.signalSchemaPluginKey) ?? null);
					const schema =
						definitions.signalSchemas[
							definitionKey("signal", definitionOwner(pluginId), subscription.signalSchemaSlug)
						];
					addPropertyRefs(subscription.metadata, schema?.propertiesSchema);
				}
				for (const installation of metadata.installations) {
					if (installation.homeSavedView?.kind === "custom") {
						savedViewIds.add(installation.homeSavedView.savedViewId);
					}
					const plugin = contracts.get(installation.packageKey);
					if (plugin) {
						addPropertyRefs(installation.config, plugin.configSchema);
						addPropertyRefs(installation.userSettings, plugin.userSettingsSchema);
					}
				}
				const entityIdMap = new Map<string, EntityId>();
				for (const [id, destinationId] of yield* staging.resolveMappings(runId, "entity", [
					...entityIds,
				])) {
					entityIdMap.set(id, EntityId.make(destinationId));
				}
				const relationshipIdMap = yield* staging.resolveMappings(runId, "relationship", [
					...relationshipIds,
				]);
				const eventIdMap = yield* staging.resolveMappings(runId, "event", [...eventIds]);
				const mappedViews = yield* staging.resolveMappings(runId, "saved-view", [...savedViewIds]);
				const customViewIds = new Map(
					[...mappedViews].map(
						([id, destinationId]) => [id, SavedViewId.make(destinationId)] as const,
					),
				);
				const reminderIdsMap = yield* staging.resolveMappings(runId, "reminder", [...reminderIds]);
				const entitySchemaById = new Map<EntityId, EntitySchemaSlug>();
				for (const identity of entityIdentityRows) {
					if (identity.destinationId !== null) {
						entitySchemaById.set(
							EntityId.make(identity.destinationId),
							EntitySchemaSlug.make(identity.entitySchemaSlug),
						);
					}
				}
				for (const entity of records.entities) {
					const destinationId = entityIdMap.get(entity.id);
					if (destinationId) {
						entitySchemaById.set(destinationId, EntitySchemaSlug.make(entity.entitySchemaSlug));
					}
				}
				for (const dependency of records.entityDependencies) {
					const destinationId = entityIdMap.get(dependency.id);
					if (destinationId) {
						entitySchemaById.set(destinationId, EntitySchemaSlug.make(dependency.entitySchemaSlug));
					}
				}
				const currentEntityRows = yield* staging.getRecords(runId, "entity", [
					...records.entities.map(({ id }) => id),
					...records.entityDependencies.map(({ id }) => id),
				]);
				const bootstrapMappings = new Map<string, EntityId>();
				const dependencyTargets = new Map<string, DependencyTarget>();
				for (const row of currentEntityRows) {
					if (row.destinationId === null) {
						continue;
					}
					if (row.section === "entity-dependencies.ndjson") {
						dependencyTargets.set(row.id, {
							inserted: row.inserted,
							id: EntityId.make(row.destinationId),
						});
					}
					if (row.section === "entities.ndjson" && !row.inserted) {
						bootstrapMappings.set(row.id, EntityId.make(row.destinationId));
					}
				}
				return {
					eventIdMap,
					entityIdMap,
					customViewIds,
					entitySchemaById,
					relationshipIdMap,
					bootstrapMappings,
					dependencyTargets,
					installationIdByKey,
					reminderIds: reminderIdsMap,
				} satisfies RestoreRecordBatchContext;
			});

			const restoreEventBatch = (
				batch: ReadonlyArray<Parameters<typeof persistence.restoreEvents>[0][number]>,
			) =>
				persistence
					.restoreEvents(batch)
					.pipe(
						Effect.mapError((error) =>
							error instanceof DbError && error.code === "23505"
								? archiveError(
										"duplicate_record_id",
										"Backup contains a duplicate event id",
										"events.ndjson",
									)
								: error,
						),
					);

			const restoreRecordBatch = Effect.fn("BackupRestoreWriter.restoreRecordBatch")(function* (
				userId: UserId,
				records: ArchiveRecords,
				events: ReadonlyArray<ArchiveEvent>,
				assetLocators: ReadonlyMap<string, AssetLocator>,
				pluginIdByKey: ReadonlyMap<string, string>,
				definitions: DefinitionSnapshot,
				context: RestoreRecordBatchContext,
			) {
				const privatePlugins = yield* plugins.listPrivateForUser(userId);
				const systemPlugins = yield* plugins.listActiveSystemPlugins();
				const installedPlugins = new Map(
					[
						...systemPlugins.map((plugin) => ({
							id: plugin.id,
							client: plugin.manifest.client,
							configSchema: plugin.manifest.configSchema,
							userSettingsSchema: plugin.manifest.userSettingsSchema,
							integrationProviders: plugin.manifest.integrationProviders,
						})),
						...privatePlugins.map((plugin) => ({
							id: plugin.id,
							client: plugin.manifest.client,
							configSchema: plugin.manifest.configSchema,
							userSettingsSchema: plugin.manifest.userSettingsSchema,
							integrationProviders: plugin.manifest.integrationProviders,
						})),
					].map((plugin) => [plugin.id, plugin]),
				);
				const getEntitySchema = (slug: string, key: null | string) => {
					const owner = key === null ? null : pluginIdByKey.get(key);
					return owner === undefined
						? undefined
						: definitions.entitySchemas[definitionKey("entity", definitionOwner(owner), slug)];
				};
				const getRelationshipSchema = (slug: string, key: null | string) => {
					const owner = key === null ? null : pluginIdByKey.get(key);
					return owner === undefined
						? undefined
						: definitions.relationshipSchemas[
								definitionKey("relationship", definitionOwner(owner), slug)
							];
				};
				const rewriteProperties = (
					properties: Record<string, unknown>,
					propertiesSchema: AppSchema,
				) =>
					Effect.gen(function* () {
						const references = yield* rewritePropertyReferences(
							yield* decodeArchiveJsonObject(properties).pipe(Effect.orDie),
							propertiesSchema,
							context.entityIdMap,
							context.relationshipIdMap,
							(id) => context.eventIdMap.get(id),
						);
						return yield* rewriteManagedAssetLocators(references, propertiesSchema, assetLocators);
					}).pipe(Effect.mapError(archiveReferenceError));

				for (const entity of records.entities) {
					const id = context.entityIdMap.get(entity.id);
					if (!id) {
						return yield* badRequest("Backup entity mapping is incomplete");
					}
					if (context.bootstrapMappings.has(entity.id)) {
						continue;
					}
					const schema = getEntitySchema(entity.entitySchemaSlug, entity.entitySchemaPluginKey);
					if (!schema) {
						return yield* badRequest("Backup references an unavailable entity schema");
					}
					const provider = yield* resolveProvider(pluginIdByKey, entity.provider);
					const properties = yield* rewriteProperties(entity.properties, schema.propertiesSchema);
					yield* validateProperties(properties, schema.propertiesSchema, "Entity properties");
					const restoredId = yield* persistence.restoreEntity({
						id,
						userId,
						properties,
						name: entity.name,
						externalId: entity.externalId,
						providerId: provider?.id ?? null,
						createdAt: parseDate(entity.createdAt),
						updatedAt: parseDate(entity.updatedAt),
						entitySchemaSlug: entity.entitySchemaSlug,
						populatedAt: entity.populatedAt ? parseDate(entity.populatedAt) : null,
						entitySchemaPluginId:
							entity.entitySchemaPluginKey === null
								? null
								: (pluginIdByKey.get(entity.entitySchemaPluginKey) ?? null),
					});
					if (restoredId !== id) {
						return yield* badRequest("Backup entity mapping changed during restore");
					}
				}

				for (const dependency of records.entityDependencies) {
					const schema = getEntitySchema(
						dependency.entitySchemaSlug,
						dependency.entitySchemaPluginKey,
					);
					const target = context.dependencyTargets.get(dependency.id);
					if (!schema || !target) {
						return yield* badRequest("Backup dependency mapping is incomplete");
					}
					if (target.inserted && dependency.kind === "snapshot") {
						const properties = yield* rewriteProperties(
							dependency.properties,
							schema.propertiesSchema,
						);
						yield* validateProperties(properties, schema.propertiesSchema, "Entity properties");
						yield* assetReferences
							.lock([{ properties, ownerUserId: null, propertiesSchema: schema.propertiesSchema }])
							.pipe(Effect.catchTag("ManagedAssetReferenceRejected", assetForbidden));
						const provider = yield* resolveProvider(pluginIdByKey, dependency.provider);
						yield* persistence.populateDependencySnapshot({
							properties,
							userId: null,
							id: target.id,
							name: dependency.name,
							providerId: provider?.id ?? null,
							externalId: dependency.externalId,
							createdAt: parseDate(dependency.createdAt),
							updatedAt: parseDate(dependency.updatedAt),
							entitySchemaSlug: dependency.entitySchemaSlug,
							populatedAt: dependency.populatedAt ? parseDate(dependency.populatedAt) : null,
							entitySchemaPluginId:
								dependency.entitySchemaPluginKey === null
									? null
									: (pluginIdByKey.get(dependency.entitySchemaPluginKey) ?? null),
						});
						for (const translation of selectTranslationsForRestore(true, dependency.translations)) {
							const translationProperties =
								translation.properties === null
									? null
									: yield* rewriteProperties(translation.properties, schema.propertiesSchema);
							if (translationProperties !== null) {
								yield* assetReferences
									.lock([
										{
											ownerUserId: null,
											properties: translationProperties,
											propertiesSchema: schema.propertiesSchema,
										},
									])
									.pipe(Effect.catchTag("ManagedAssetReferenceRejected", assetForbidden));
							}
							yield* persistence.restoreTranslation({
								entityId: target.id,
								name: translation.name,
								language: translation.language,
								properties: translationProperties,
								createdAt: parseDate(translation.createdAt),
								updatedAt: parseDate(translation.updatedAt),
								populatedAt: translation.populatedAt ? parseDate(translation.populatedAt) : null,
							});
						}
					}
				}

				for (const relationship of records.relationships) {
					const schema = getRelationshipSchema(
						relationship.relationshipSchemaSlug,
						relationship.relationshipSchemaPluginKey,
					);
					if (!schema || relationship.scope !== "user") {
						return yield* badRequest("Backup relationship mapping is invalid");
					}
					const rewritten = yield* rewriteRelationshipReferences(relationship, context.entityIdMap);
					const properties = yield* rewriteProperties(
						relationship.properties,
						schema.propertiesSchema,
					);
					yield* validateProperties(properties, schema.propertiesSchema, "Relationship properties");
					const restoredId = yield* persistence.restoreRelationship({
						userId,
						properties,
						createdAt: parseDate(relationship.createdAt),
						sourceEntityId: EntityId.make(rewritten.sourceEntityId),
						targetEntityId: EntityId.make(rewritten.targetEntityId),
						relationshipSchemaSlug: relationship.relationshipSchemaSlug,
						id:
							context.relationshipIdMap.get(relationship.id) ??
							(yield* badRequest("Backup relationship mapping is incomplete")),
						relationshipSchemaPluginId:
							relationship.relationshipSchemaPluginKey === null
								? null
								: (pluginIdByKey.get(relationship.relationshipSchemaPluginKey) ?? null),
					});
					if (restoredId !== context.relationshipIdMap.get(relationship.id)) {
						return yield* badRequest("Backup relationship mapping changed during restore");
					}
				}

				if (records.reminders.length > 0) {
					yield* admission.currentAccount(userId);
					for (const row of records.reminders) {
						const unfinished = row.state === "scheduled" || row.state === "processing";
						const entityId = row.entityId === null ? null : context.entityIdMap.get(row.entityId);
						const parentEntityId =
							row.parentEntityId === null ? null : context.entityIdMap.get(row.parentEntityId);
						if (entityId === undefined || parentEntityId === undefined) {
							return yield* badRequest("Backup reminder entity mapping is incomplete");
						}
						yield* persistence.restoreReminder({
							userId,
							entityId,
							parentEntityId,
							reason: row.reason,
							message: row.message,
							outcome: row.outcome,
							entityTitle: row.entityTitle,
							createdAt: parseDate(row.createdAt),
							updatedAt: parseDate(row.updatedAt),
							timezone: unfinished ? null : row.timezone,
							state: unfinished ? "needs-scheduling" : row.state,
							settledAt: row.settledAt === null ? null : parseDate(row.settledAt),
							dueAt: unfinished || row.dueAt === null ? null : parseDate(row.dueAt),
							processingAt: row.processingAt === null ? null : parseDate(row.processingAt),
							replacementId:
								row.replacementId === null ? null : context.reminderIds.get(row.replacementId),
							id:
								context.reminderIds.get(row.id) ??
								(yield* badRequest("Backup reminder mapping is incomplete")),
							originalSchedule: unfinished
								? {
										dueAt: row.dueAt,
										timezone: row.timezone,
										date: row.originalSchedule?.date ?? null,
										mayHaveSent:
											row.state === "processing" || row.originalSchedule?.mayHaveSent === true,
									}
								: row.originalSchedule,
						});
					}
				}

				const eventBatch: Parameters<typeof restoreEventBatch>[0][number][] = [];
				for (const event of events) {
					const entityId = context.entityIdMap.get(event.entityId);
					if (!entityId) {
						return yield* badRequest("Backup event references an unknown entity");
					}
					const entitySchemaSlug = context.entitySchemaById.get(entityId);
					if (!entitySchemaSlug) {
						return yield* badRequest("Backup event references an unknown entity schema");
					}
					const propertiesSchema = getEntitySchema(entitySchemaSlug, event.eventSchemaPluginKey)
						?.eventSchemas[event.eventSchemaSlug]?.propertiesSchema;
					if (!propertiesSchema) {
						return yield* badRequest("Backup references an unavailable event schema");
					}
					const rewritten = yield* rewriteEventReferences(
						event,
						propertiesSchema,
						context.entityIdMap,
						context.relationshipIdMap,
						(id) => context.eventIdMap.get(id),
					);
					const properties = yield* rewriteManagedAssetLocators(
						rewritten.properties,
						propertiesSchema,
						assetLocators,
					).pipe(Effect.mapError(archiveReferenceError));
					yield* validateProperties(properties, propertiesSchema, "Event properties");
					eventBatch.push({
						userId,
						entityId,
						properties,
						orderKey: event.orderKey,
						createdAt: parseDate(event.createdAt),
						updatedAt: parseDate(event.updatedAt),
						eventSchemaSlug: event.eventSchemaSlug,
						occurredAt: parseDate(event.occurredAt),
						orderCreatedAt: parseDate(event.orderCreatedAt),
						references: eventPropertyReferences(propertiesSchema, properties),
						id: sha256Hex(identityTupleKey("backup-event", userId, event.id)),
						sessionEntityId: rewritten.sessionEntityId
							? EntityId.make(rewritten.sessionEntityId)
							: null,
						eventSchemaPluginId:
							event.eventSchemaPluginKey === null
								? null
								: (pluginIdByKey.get(event.eventSchemaPluginKey) ?? null),
					});
					if (eventBatch.length >= RESTORE_EVENT_BATCH_SIZE) {
						yield* restoreEventBatch(eventBatch.splice(0));
					}
				}
				yield* restoreEventBatch(eventBatch.splice(0));

				for (const view of records.savedViews) {
					if (view.kind === "builtin-override") {
						const pluginId = yield* mappedPluginId(pluginIdByKey, view.pluginKey);
						if (
							!definitions.savedViews[
								definitionKey("saved-view", definitionOwner(pluginId), view.slug)
							]
						) {
							return yield* badRequest("Backup references an unavailable built-in saved view");
						}
						yield* persistence.restoreBuiltinOverride({
							userId,
							pluginId,
							slug: view.slug,
							isHidden: view.isHidden,
							sortOrder: view.sortOrder,
						});
						continue;
					}
					const pluginInstallationId =
						view.pluginKey === null ? null : context.installationIdByKey.get(view.pluginKey);
					if (view.pluginKey !== null && !pluginInstallationId) {
						return yield* badRequest("Backup saved view installation mapping is invalid");
					}
					let renderer: SavedViewRenderer;
					if (view.renderer.kind === "plugin") {
						const pluginId = pluginIdByKey.get(view.renderer.pluginKey);
						if (!pluginId) {
							return yield* badRequest("Backup saved view renderer mapping is invalid");
						}
						renderer = { pluginId, kind: "plugin", exportName: view.renderer.exportName };
					} else {
						renderer = view.renderer;
					}
					const pluginPage =
						renderer.kind === "plugin"
							? installedPlugins.get(renderer.pluginId)?.client?.exports?.[renderer.exportName]
							: undefined;
					const dataSources = yield* importQueryPluginReferences(view.dataSources, pluginIdByKey);
					let settings = yield* importRendererSettings(view.renderer, view.settings, pluginIdByKey);
					if (pluginPage?.kind === "page") {
						settings = yield* rewriteProperties(settings, pluginPage.settingsSchema);
					}
					yield* validateSavedViewDefinition(
						renderer,
						settings,
						dataSources,
						pluginPage?.kind === "page" ? pluginPage : null,
					).pipe(Effect.mapError(() => badRequest("Backup saved view definition is invalid")));
					if (pluginPage?.kind === "page") {
						yield* assetReferences
							.lock([
								{
									ownerUserId: userId,
									properties: settings,
									propertiesSchema: pluginPage.settingsSchema,
								},
							])
							.pipe(Effect.catchTag("ManagedAssetReferenceRejected", assetForbidden));
					}
					const restored = yield* persistence.restoreCustomView({
						userId,
						renderer,
						settings,
						dataSources,
						slug: view.slug,
						name: view.name,
						icon: view.icon,
						pluginInstallationId,
						isHidden: view.isHidden,
						sortOrder: view.sortOrder,
						createdAt: parseDate(view.createdAt),
						updatedAt: parseDate(view.updatedAt),
						id:
							context.customViewIds.get(view.id) ??
							(yield* badRequest("Backup custom view mapping is incomplete")),
					});
					if (!restored) {
						return yield* badRequest("Backup saved view could not be restored");
					}
				}
				for (const override of records.calendarSourceOverrides) {
					const pluginId = yield* mappedPluginId(pluginIdByKey, override.pluginKey);
					if (
						pluginId === null ||
						!definitions.calendarSources[
							definitionKey("calendar-source", definitionOwner(pluginId), override.slug)
						]
					) {
						return yield* badRequest("Backup references an unavailable calendar source");
					}
					yield* persistence.restoreCalendarSourceOverride({
						userId,
						pluginId,
						slug: override.slug,
						isHidden: override.isHidden,
					});
				}
				for (const publication of records.publications) {
					const source = yield* restoredPublicationSource(
						publication.source,
						pluginIdByKey,
						context,
					);
					yield* persistence.restorePublication({
						userId,
						source,
						icon: publication.icon,
						title: publication.title,
						description: publication.description,
						showOwnerName: publication.showOwnerName,
						createdAt: parseDate(publication.createdAt),
					});
				}
				for (const integration of records.integrations) {
					const pluginId =
						integration.packageKey === null ? undefined : pluginIdByKey.get(integration.packageKey);
					const plugin = pluginId ? installedPlugins.get(pluginId) : undefined;
					const settingsSchema = resolveIntegrationSettingsSchema(
						integration,
						plugin?.integrationProviders,
					);
					const pluginInstallationId =
						integration.packageKey === null
							? null
							: context.installationIdByKey.get(integration.packageKey);
					if (
						!settingsSchema ||
						pluginInstallationId === undefined ||
						(integration.packageKey !== null && !plugin)
					) {
						return yield* badRequest("Backup integration mapping is invalid");
					}
					const providerSpecifics = yield* rewriteProperties(
						integration.providerSpecifics,
						settingsSchema,
					);
					yield* validateIntegrationSettings(integration, providerSpecifics, settingsSchema);
					yield* persistence.restoreForUser({
						userId,
						providerSpecifics,
						id: yield* newUuid,
						lot: integration.lot,
						pluginInstallationId,
						name: integration.name,
						provider: integration.provider,
						extraSettings: integration.extraSettings,
						syncOwnership: integration.syncOwnership,
						createdAt: parseDate(integration.createdAt),
						updatedAt: parseDate(integration.updatedAt),
						minimumProgress: integration.minimumProgress,
						maximumProgress: integration.maximumProgress,
						isDisabled: resolveRestoredIntegrationDisabled(integration, settingsSchema),
						lastFinishedAt: integration.lastFinishedAt
							? parseDate(integration.lastFinishedAt)
							: null,
					});
				}
				for (const subscription of records.notificationSubscriptions) {
					const pluginId =
						subscription.signalSchemaPluginKey === null
							? null
							: pluginIdByKey.get(subscription.signalSchemaPluginKey);
					if (pluginId === undefined) {
						return yield* badRequest("Backup subscription mapping is invalid");
					}
					const definition =
						definitions.signalSchemas[
							definitionKey("signal", definitionOwner(pluginId), subscription.signalSchemaSlug)
						];
					if (!definition) {
						return yield* badRequest("Backup references an unavailable notification subscription");
					}
					const metadataValue =
						subscription.metadata && isArchiveJsonObject(subscription.metadata)
							? yield* rewriteProperties(subscription.metadata, definition.propertiesSchema)
							: subscription.metadata;
					const restored = yield* persistence.restoreNotificationSubscription({
						userId,
						metadata: metadataValue,
						signalSchemaPluginId: pluginId,
						isActive: subscription.isActive,
						signalSchemaSlug: SignalSchemaSlug.make(subscription.signalSchemaSlug),
					});
					if (!restored) {
						return yield* badRequest("Backup target is missing a notification subscription");
					}
				}
				return yield* Effect.void;
			});

			const allocateArchiveMappings = Effect.fn("BackupRestoreWriter.allocateArchiveMappings")(
				function* (userId: UserId, runId: BackupRunId, pluginIdByKey: ReadonlyMap<string, string>) {
					yield* persistence.assertBootstrapArchiveUnambiguous(userId, runId, pluginIdByKey);
					const systemIds = new Set(
						(yield* plugins.listActiveSystemPlugins()).map((plugin) => plugin.id),
					);
					for (const path of STREAMED_SECTION_PATHS) {
						yield* forEachStagePage(runId, path, (rows) =>
							Effect.gen(function* () {
								const mappings: Array<{
									readonly id: string;
									readonly inserted?: boolean;
									readonly destinationId: string;
								}> = [];
								switch (path) {
									case "events.ndjson": {
										const values = yield* Effect.forEach(rows, (row) =>
											Schema.decodeUnknownEffect(ArchiveEvent)(row.value),
										);
										for (const value of values) {
											mappings.push({
												id: value.id,
												destinationId: sha256Hex(
													identityTupleKey("backup-event", userId, value.id),
												),
											});
										}
										break;
									}
									case "entities.ndjson": {
										const values = yield* Effect.forEach(rows, (row) =>
											Schema.decodeUnknownEffect(ArchiveUserEntity)(row.value),
										);
										const bootstrap = values.filter((value) => isBootstrapEntity(value));
										const scopes = new Map<
											string,
											{ entitySchemaSlug: EntitySchemaSlug; entitySchemaPluginId: null | string }
										>();
										for (const entity of bootstrap) {
											const pluginId =
												entity.entitySchemaPluginKey === null
													? null
													: pluginIdByKey.get(entity.entitySchemaPluginKey);
											if (pluginId === undefined) {
												return yield* badRequest("Backup bootstrap schema owner is unavailable");
											}
											const scope = {
												entitySchemaPluginId: pluginId,
												entitySchemaSlug: EntitySchemaSlug.make(entity.entitySchemaSlug),
											};
											scopes.set(bootstrapSchemaIdentity(entity.entitySchemaSlug, pluginId), scope);
										}
										const existing = yield* entities.findUserEntitiesWithoutProvenance({
											userId,
											scopes: [...scopes.values()],
										});
										const bootstrapMappings = yield* resolveBootstrapEntityMappings(
											values,
											[...existing.values()].map(
												({ id, externalId, entitySchemaSlug, entitySchemaPluginId }) => ({
													id,
													externalId,
													provider: null,
													entitySchemaSlug,
													entitySchemaPluginId,
												}),
											),
											pluginIdByKey,
										);
										for (const entity of values) {
											const target = bootstrapMappings.get(entity.id);
											mappings.push({
												id: entity.id,
												inserted: target === undefined,
												destinationId: target ?? (yield* newUuid),
											});
										}
										break;
									}
									case "reminders.ndjson": {
										const values = yield* Effect.forEach(rows, (row) =>
											Schema.decodeUnknownEffect(ArchiveReminder)(row.value),
										);
										for (const value of values) {
											mappings.push({ id: value.id, destinationId: yield* newUuid });
										}
										break;
									}
									case "saved-views.ndjson": {
										const values = yield* Effect.forEach(rows, (row) =>
											Schema.decodeUnknownEffect(ArchiveSavedView)(row.value),
										);
										for (const value of values) {
											mappings.push({ id: value.id, destinationId: yield* newUuid });
										}
										break;
									}
									case "fold-values.ndjson":
									case "calendar-source-overrides.ndjson": {
										for (const row of rows) {
											mappings.push({ id: row.id, destinationId: row.id });
										}
										break;
									}
									case "integrations.ndjson":
									case "publications.ndjson":
										break;
									case "relationships.ndjson": {
										const values = yield* Effect.forEach(rows, (row) =>
											Schema.decodeUnknownEffect(ArchiveRelationship)(row.value),
										);
										for (const value of values) {
											mappings.push({ id: value.id, destinationId: yield* newUuid });
										}
										break;
									}
									case "entity-dependencies.ndjson": {
										const values = yield* Effect.forEach(rows, (row) =>
											Schema.decodeUnknownEffect(ArchiveEntityDependency)(row.value),
										);
										const restoredAt = yield* DateTime.nowAsDate;
										for (const dependency of values) {
											const pluginId =
												dependency.entitySchemaPluginKey === null
													? null
													: pluginIdByKey.get(dependency.entitySchemaPluginKey);
											if (
												pluginId === undefined ||
												(pluginId !== null && !systemIds.has(pluginId))
											) {
												return yield* badRequest(
													"Backup global dependency requires verified system ownership",
												);
											}
											const provider = yield* resolveProvider(pluginIdByKey, dependency.provider);
											const target = yield* persistence.reserveDependency({
												userId: null,
												properties: {},
												populatedAt: null,
												id: yield* newUuid,
												name: dependency.name,
												entitySchemaPluginId: pluginId,
												providerId: provider?.id ?? null,
												externalId: dependency.externalId,
												entitySchemaSlug: dependency.entitySchemaSlug,
												createdAt:
													dependency.kind === "snapshot"
														? parseDate(dependency.createdAt)
														: restoredAt,
												updatedAt:
													dependency.kind === "snapshot"
														? parseDate(dependency.updatedAt)
														: restoredAt,
											});
											mappings.push({
												id: dependency.id,
												destinationId: target.id,
												inserted: target.inserted,
											});
										}
										break;
									}
									case "notification-subscriptions.ndjson": {
										for (const row of rows) {
											mappings.push({ id: row.id, destinationId: row.id });
										}
										break;
									}
								}
								if (mappings.length > 0) {
									yield* staging.setMappings(runId, archiveSectionNamespace(path), mappings);
								}
								return yield* Effect.void;
							}),
						);
					}
				},
			);

			const restoreMetadata = Effect.fn("BackupRestoreWriter.restoreMetadata")(function* (
				userId: UserId,
				runId: BackupRunId,
				metadata: ArchiveMetadata,
				assetLocators: ReadonlyMap<string, AssetLocator>,
				pluginIdByKey: ReadonlyMap<string, string>,
				definitions: DefinitionSnapshot,
			) {
				const privatePlugins = yield* plugins.listPrivateForUser(userId);
				const systemPlugins = yield* plugins.listActiveSystemPlugins();
				const installedPlugins = new Map(
					[...systemPlugins, ...privatePlugins].map((plugin) => [plugin.id, plugin]),
				);
				const pluginKeyById = new Map([...pluginIdByKey].map(([key, id]) => [id, key]));
				const privateKeys = new Set(metadata.privatePlugins.map(({ key }) => key));
				for (const plugin of privatePlugins) {
					const key = pluginKeyById.get(plugin.id);
					if (key !== undefined) {
						privateKeys.add(key);
					}
				}
				const systemPackageIds = new Set(
					systemPlugins.map((plugin) => plugin.manifest.metadata.packageId),
				);
				const batchContext = yield* buildBatchContext(
					runId,
					metadata,
					emptyArchiveRecords(metadata),
					[],
					pluginIdByKey,
					definitions,
					new Map(),
				);
				const rewriteMetadataProperties = (
					properties: Record<string, unknown>,
					propertiesSchema: AppSchema,
				) =>
					Effect.gen(function* () {
						const references = yield* rewritePropertyReferences(
							yield* decodeArchiveJsonObject(properties).pipe(Effect.orDie),
							propertiesSchema,
							batchContext.entityIdMap,
							batchContext.relationshipIdMap,
							(id) => batchContext.eventIdMap.get(id),
						);
						return yield* rewriteManagedAssetLocators(references, propertiesSchema, assetLocators);
					}).pipe(Effect.mapError(archiveReferenceError));
				const installationIdByKey = new Map<string, string>();
				const activations: Array<{
					readonly id: string;
					readonly updatedAt: Date;
					readonly isHidden: boolean;
					readonly healthReason: null | string;
					readonly health: "ready" | "incompatible" | "needs-configuration";
					readonly incompatibilityReason: ArchiveInstallation["incompatibilityReason"];
				}> = [];
				for (const state of metadata.installations) {
					const pluginId = pluginIdByKey.get(state.packageKey);
					const installedPlugin = pluginId ? installedPlugins.get(pluginId) : undefined;
					if (!pluginId || !installedPlugin || installationIdByKey.has(state.packageKey)) {
						return yield* badRequest("Backup plugin installation mapping is invalid");
					}
					const config = yield* rewriteMetadataProperties(
						yield* decodeArchiveJsonObject(state.config).pipe(Effect.orDie),
						installedPlugin.manifest.configSchema,
					);
					const userSettingsSchema = installedPlugin.manifest.userSettingsSchema;
					const rewrittenUserSettings = yield* rewriteMetadataProperties(
						state.userSettings,
						userSettingsSchema ?? emptyPluginUserSettingsSchema,
					);
					const userSettings = yield* resolveRestoredPluginUserSettings(
						rewrittenUserSettings,
						userSettingsSchema,
					);
					const isSystemPackage = !privateKeys.has(state.packageKey);
					const redactedConfigNeedsConfiguration = isSystemPackage
						? false
						: (yield* validateRestoredProperties(
								config,
								installedPlugin.manifest.configSchema,
								state.configuredSecretPaths,
								state.lifecycleIntent === "needs-configuration" ||
									state.lifecycleIntent === "incompatible",
							)).needsConfiguration;
					const lifecycle = resolveRestoredInstallationLifecycle(
						state,
						installedPlugin.manifest.configSchema,
						redactedConfigNeedsConfiguration,
						!isSystemPackage &&
							metadata.privatePlugins.some(
								(plugin) =>
									plugin.key === state.packageKey && systemPackageIds.has(plugin.packageId),
							),
					);
					const restored = yield* persistence.restoreInstallation({
						userId,
						config,
						pluginId,
						userSettings,
						isHidden: true,
						health: "installing",
						sortOrder: state.sortOrder,
						isInitialized: state.isInitialized,
						createdAt: parseDate(state.createdAt),
						updatedAt: parseDate(state.updatedAt),
						preserveExistingConfig: isSystemPackage,
						configuredSecretPaths: state.configuredSecretPaths,
						allowMissingRequiredSecrets:
							state.lifecycleIntent === "needs-configuration" ||
							state.lifecycleIntent === "incompatible",
					});
					if (!restored) {
						return yield* badRequest("Backup plugin installation could not be restored");
					}
					installationIdByKey.set(state.packageKey, restored.id);
					activations.push({
						id: restored.id,
						...lifecycle,
						updatedAt: parseDate(state.updatedAt),
					});
				}
				yield* staging.setMappings(
					runId,
					"installation",
					[...installationIdByKey].map(([id, destinationId]) => ({ id, destinationId })),
				);
				if (!(yield* persistence.restorePortableProfile(userId, metadata.profile))) {
					return yield* badRequest("Backup user does not exist");
				}
				return { activations, privateKeys, installationIdByKey };
			});

			const restoreDefaultSubscriptions = Effect.fn(
				"BackupRestoreWriter.restoreDefaultSubscriptions",
			)(function* (
				userId: UserId,
				definitions: DefinitionSnapshot,
				pluginIdByKey: ReadonlyMap<string, string>,
				privateKeys: ReadonlySet<string>,
			) {
				const pluginKeyById = new Map([...pluginIdByKey].map(([key, id]) => [id, key]));
				for (const definition of Object.values(definitions.signalSchemas)) {
					const pluginKey = definition.pluginId
						? pluginKeyById.get(definition.pluginId)
						: undefined;
					if (
						definition.catalogState === "active" &&
						definition.pluginId &&
						pluginKey !== undefined &&
						privateKeys.has(pluginKey)
					) {
						yield* persistence.restoreDefaultSubscription({
							userId,
							metadata: null,
							isActive: true,
							signalSchemaPluginId: definition.pluginId,
							signalSchemaSlug: SignalSchemaSlug.make(definition.slug),
						});
					}
				}
			});

			const finishMetadata = Effect.fn("BackupRestoreWriter.finishMetadata")(function* (
				userId: UserId,
				runId: BackupRunId,
				metadata: ArchiveMetadata,
				pluginIdByKey: ReadonlyMap<string, string>,
				installationIdByKey: ReadonlyMap<string, string>,
				activations: ReadonlyArray<{
					readonly id: string;
					readonly updatedAt: Date;
					readonly isHidden: boolean;
					readonly healthReason: null | string;
					readonly health: "ready" | "incompatible" | "needs-configuration";
					readonly incompatibilityReason: ArchiveInstallation["incompatibilityReason"];
				}>,
			) {
				const customIds = yield* staging.resolveMappings(
					runId,
					"saved-view",
					metadata.installations.flatMap((state) =>
						state.homeSavedView?.kind === "custom" ? [state.homeSavedView.savedViewId] : [],
					),
				);
				for (const state of metadata.installations) {
					if (state.homeSavedView === null) {
						continue;
					}
					const installationId = installationIdByKey.get(state.packageKey);
					const reference = yield* restoredSavedViewReference(
						state.homeSavedView,
						pluginIdByKey,
						customIds,
						"home saved view",
					);
					if (
						!installationId ||
						!(yield* persistence.restoreInstallationHome(userId, installationId, reference))
					) {
						return yield* badRequest("Backup installation home saved view could not be restored");
					}
				}
				for (const activation of activations) {
					if (!(yield* persistence.activateRestored(activation))) {
						return yield* badRequest("Backup plugin installation could not be activated");
					}
				}
				return yield* Effect.void;
			});

			const restoreFoldValues = Effect.fn("BackupRestoreWriter.restoreFoldValues")(function* (
				userId: UserId,
				runId: BackupRunId,
				values: ReadonlyArray<ArchiveFoldValue>,
				pluginIdByKey: ReadonlyMap<string, string>,
			) {
				for (const value of values) {
					const pluginId = pluginIdByKey.get(value.pluginKey);
					if (pluginId === undefined) {
						continue;
					}
					const tokens = [...foldValueTokens(value.value)];
					const entityIds = yield* staging.resolveMappings(runId, "entity", [
						value.entityId,
						...tokens,
					]);
					const eventIds = yield* staging.resolveMappings(runId, "event", tokens);
					const entityId = entityIds.get(value.entityId);
					if (entityId === undefined) {
						return yield* badRequest("Backup fold value entity mapping is incomplete");
					}
					yield* persistence.restoreFoldValue({
						userId,
						pluginId,
						value: value.value,
						entityId: EntityId.make(entityId),
						ids: Object.fromEntries([...entityIds, ...eventIds]),
					});
				}
				return yield* Effect.void;
			});

			const restoreArchive = Effect.fn("BackupRestoreWriter.restoreArchive")(function* (
				userId: UserId,
				runId: BackupRunId,
				metadata: ArchiveMetadata,
				pluginIdByKey: ReadonlyMap<string, string>,
				definitions: DefinitionSnapshot,
				assetLocators: ReadonlyMap<string, AssetLocator>,
			) {
				yield* database.requireTransaction;
				yield* allocateArchiveMappings(userId, runId, pluginIdByKey);
				const restoredMetadata = yield* restoreMetadata(
					userId,
					runId,
					metadata,
					assetLocators,
					pluginIdByKey,
					definitions,
				);
				yield* restoreDefaultSubscriptions(
					userId,
					definitions,
					pluginIdByKey,
					restoredMetadata.privateKeys,
				);
				for (const path of STREAMED_SECTION_PATHS) {
					yield* forEachStagePage(runId, path, (rows) =>
						Effect.gen(function* () {
							let records: ArchiveRecords;
							let events: ReadonlyArray<ArchiveEvent> = [];
							switch (path) {
								case "events.ndjson": {
									events = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveEvent)(row.value),
									);
									records = emptyArchiveRecords(metadata);
									break;
								}
								case "entities.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveUserEntity)(row.value),
									);
									records = emptyArchiveRecords(metadata, { entities: values });
									break;
								}
								case "reminders.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveReminder)(row.value),
									);
									records = emptyArchiveRecords(metadata, { reminders: values });
									break;
								}
								case "fold-values.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveFoldValue)(row.value),
									);
									return yield* restoreFoldValues(userId, runId, values, pluginIdByKey);
								}
								case "saved-views.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveSavedView)(row.value),
									);
									records = emptyArchiveRecords(metadata, { savedViews: values });
									break;
								}
								case "integrations.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveIntegration)(row.value),
									);
									records = emptyArchiveRecords(metadata, { integrations: values });
									break;
								}
								case "publications.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchivePublication)(row.value),
									);
									records = emptyArchiveRecords(metadata, { publications: values });
									break;
								}
								case "relationships.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveRelationship)(row.value),
									);
									records = emptyArchiveRecords(metadata, { relationships: values });
									break;
								}
								case "entity-dependencies.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveEntityDependency)(row.value),
									);
									records = emptyArchiveRecords(metadata, { entityDependencies: values });
									break;
								}
								case "calendar-source-overrides.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveCalendarSourceOverride)(row.value),
									);
									records = emptyArchiveRecords(metadata, { calendarSourceOverrides: values });
									break;
								}
								case "notification-subscriptions.ndjson": {
									const values = yield* Effect.forEach(rows, (row) =>
										Schema.decodeUnknownEffect(ArchiveNotificationSubscription)(row.value),
									);
									records = emptyArchiveRecords(metadata, { notificationSubscriptions: values });
									break;
								}
							}
							const context = yield* buildBatchContext(
								runId,
								metadata,
								records,
								events,
								pluginIdByKey,
								definitions,
								restoredMetadata.installationIdByKey,
							);
							return yield* restoreRecordBatch(
								userId,
								records,
								events,
								assetLocators,
								pluginIdByKey,
								definitions,
								context,
							);
						}),
					);
				}
				yield* groups
					.validateHistorical(
						userId,
						Object.values(definitions.entitySchemas).flatMap((entity) =>
							Object.values(entity.eventSchemas).flatMap((event) =>
								event.eventGroup === undefined
									? []
									: [
											{
												eventGroup: event.eventGroup,
												eventSchemaSlug: EventSchemaSlug.make(event.slug),
												entitySchemaSlug: EntitySchemaSlug.make(entity.slug),
												pluginId: event.pluginId === null ? null : PluginId.make(event.pluginId),
											},
										],
							),
						),
					)
					.pipe(
						Effect.mapError((error) =>
							error._tag === "EventBadRequest"
								? archiveError(
										"invalid_entry",
										"message" in error.reason
											? error.reason.message
											: "Event group constraints are invalid",
										"events.ndjson",
									)
								: error,
						),
					);
				yield* finishMetadata(
					userId,
					runId,
					metadata,
					pluginIdByKey,
					restoredMetadata.installationIdByKey,
					restoredMetadata.activations,
				);
			});

			return { preflight, stageArchive, restoreArchive, preflightArchive, assertRequiredPlugins };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(BackupRestorePersistence.layer),
	);
}
