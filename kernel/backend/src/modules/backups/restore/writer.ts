import { badRequest, DbError } from "@ryot-app/contract/errors";
import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { BackupBadRequest } from "@ryot-app/contract/modules/backups/schemas";
import { dataJsonIntegrationSettingsSchema } from "@ryot-app/contract/modules/imports/data-json";
import {
	definitionKey,
	definitionOwner,
	identityTupleKey,
	pluginPackageKey,
	type SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityBrowserSavedViewSettings,
	type SavedViewRenderer,
} from "@ryot-app/contract/modules/saved-views/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SavedViewId,
	SignalSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Data, Effect, Layer, Schema, Stream } from "effect";

import { makeManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { AutomationsRepository } from "#modules/automations/repository";
import {
	rewriteManagedAssetLocators,
	rewritePropertyReferences,
	type DataReferenceError,
} from "#modules/backups/data-references";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
	type DefinitionSnapshot,
} from "#modules/definitions/snapshot";
import { mergeManifestDefinitions } from "#modules/definitions/source";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { RESTORE_EVENT_BATCH_SIZE } from "#modules/events/repository";
import { validateRestoredProperties } from "#modules/plugins/configuration/revisions";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { validateAdditiveSchemaEvolution } from "#modules/plugins/packages/schema-evolution";
import type { StoredPlugin } from "#modules/plugins/packages/types";
import { resolvePluginUserSettings } from "#modules/plugins/preferences/user-settings";
import {
	isEntityBrowserRenderer,
	validateSavedViewDefinition,
} from "#modules/saved-views/definition-validation";
import { DatabaseSession } from "#platform/db/session";

import type { ValidatedArchiveEvents } from "../archive/archive";
import { archiveError } from "../archive/error";
import {
	importQueryPluginReferences,
	importRendererSettings,
	rewriteEventReferences,
	rewriteRelationshipReferences,
} from "../archive/references";
import {
	decodeArchiveJsonObject,
	archivePluginDefinitionContract,
	isArchiveJsonObject,
	type ArchiveRecords,
	type ArchiveEntityDependency,
	type ArchiveInstallation,
	type ArchiveRequiredPlugin,
} from "../archive/schemas";
import { BackupRestorePersistence } from "./persistence";

export class RequiredBackupPluginUnavailable extends Data.TaggedError(
	"RequiredBackupPluginUnavailable",
)<{ readonly packageId: ArchiveRequiredPlugin["packageId"]; readonly requiredVersion: string }> {}

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
	({ pluginId }: { readonly pluginId: string | null }) =>
		pluginId === null || !systemIds.has(pluginId);

const mappedPluginId = Effect.fn(function* (
	pluginIdByKey: ReadonlyMap<string, string>,
	key: string | null,
) {
	if (key === null) {
		return null;
	}
	const pluginId = pluginIdByKey.get(key);
	return pluginId ?? (yield* badRequest(`Backup references unmapped plugin key '${key}'`));
});

const mappedOwner = (pluginIdByKey: ReadonlyMap<string, string>, key: string | null) =>
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
						{ savedViews: [], entitySchemas: [], signalSchemas: [], relationshipSchemas: [] },
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
	let definition: AppPropertyDefinition | undefined = segments[0]
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
		| "configuredSecretPaths"
		| "hiddenIntent"
		| "lifecycleIntent"
		| "incompatibilityReason"
		| "healthReason"
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

export const resolveRestoredPluginUserSettings = Effect.fn(function* (
	userSettings: Record<string, unknown>,
	settingsSchema: AppSchema | undefined,
) {
	return yield* resolvePluginUserSettings(
		settingsSchema ?? emptyPluginUserSettingsSchema,
		userSettings,
	).pipe(Effect.mapError((error) => badRequest(error.message)));
});

const bootstrapSchemaIdentity = (entitySchemaSlug: string, entitySchemaPluginId: string | null) =>
	JSON.stringify([entitySchemaSlug, entitySchemaPluginId]);

type ArchivedBootstrapEntity = Pick<
	ArchiveRecords["entities"][number],
	"id" | "provider" | "externalId" | "entitySchemaSlug" | "entitySchemaPluginKey"
>;
type TargetBootstrapEntity = Pick<
	PortableEntityRecord,
	"id" | "provider" | "externalId" | "entitySchemaSlug" | "entitySchemaPluginId"
>;

const isBootstrapEntity = (entity: {
	readonly provider: unknown;
	readonly externalId: string | null;
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
		let entitySchemaPluginId: string | null = null;
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
	schemaPluginKey: string | null,
) {
	if (
		(dependency.identity.kind === "provider" || dependency.identity.kind === "bootstrap") &&
		schemaPluginKey !== dependency.identity.pluginKey
	) {
		return yield* badRequest("Backup global dependency schema is not owned by its plugin");
	}
	if (
		dependency.identity.kind === "provider" &&
		(dependency.externalId === null ||
			dependency.provider === null ||
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
	translations: ArchiveEntityDependency["translations"],
) => (inserted ? translations : []);

export const preflightProvenance = Effect.fn(function* (
	records: ArchiveRecords,
	archivedEvents: ValidatedArchiveEvents,
	pluginIdByKey: ReadonlyMap<string, string>,
	definitions: DefinitionSnapshot,
	requiredPlugins: ReadonlyArray<ArchiveRequiredPlugin>,
) {
	const privateKeys = new Set(records.privatePlugins.map(({ key }) => key));
	const entitiesById = new Map(
		[...records.entities, ...records.entityDependencies].map((entity) => [entity.id, entity]),
	);
	const definition = (kind: string, slug: string, key: string | null) =>
		Effect.map(mappedOwner(pluginIdByKey, key), (owner) => definitionKey(kind, owner, slug));
	const assertOwner = Effect.fn(function* (
		key: string | null,
		schemaDefinition: { readonly pluginId?: string | null | undefined } | undefined,
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
		provider: { readonly pluginKey: string; readonly providerSlug: string } | null,
		schemaKey: string | null,
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
		const home = installation.homeSavedView;
		if (home && home.kind !== "custom") {
			const key = home.kind === "plugin" ? home.pluginKey : null;
			yield* assertOwner(
				key,
				definitions.savedViews[yield* definition("saved-view", home.slug, key)],
				"home saved view",
			);
		}
	}
	for (const integration of records.integrations) {
		if (integration.packageKey !== null) {
			yield* mappedPluginId(pluginIdByKey, integration.packageKey);
		}
		const provider =
			integration.packageKey === null
				? { settingsSchema: dataJsonIntegrationSettingsSchema }
				: contracts
						.get(integration.packageKey)
						?.integrationProviders.find(
							({ lot, slug }) => slug === integration.provider && lot === integration.lot,
						);
		if (!provider) {
			return yield* badRequest("Backup integration provider is not declared by its owner");
		}
		yield* parseAppSchemaProperties({
			kind: "Integration settings",
			properties: integration.providerSpecifics,
			propertiesSchema: provider.settingsSchema,
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
		if (schema) {
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
				const endpoint = entitiesById.get(id);
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
				if (
					decoded.addAction?.type === "provider-search" &&
					!definitions.entitySchemas[
						definitionKey("entity", decoded.addAction.schema.owner, decoded.addAction.schema.slug)
					]
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
				null,
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
	for (const { id, entitySchemaSlug, entitySchemaPluginKey } of entitiesById.values()) {
		entitySchemaById.set(id, yield* definition("entity", entitySchemaSlug, entitySchemaPluginKey));
	}
	yield* Stream.runForEach(archivedEvents.read(), (event) =>
		Effect.gen(function* () {
			if (event.sessionEntityId !== null && !entitiesById.has(event.sessionEntityId)) {
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

export class BackupRestoreWriter extends Context.Service<BackupRestoreWriter>()(
	"BackupRestoreWriter",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const lockAssetReferences = makeManagedAssetReferenceLocker(session);
			const persistence = yield* BackupRestorePersistence;
			const plugins = yield* PluginRepository;
			const entities = yield* EntitiesRepository;
			const automations = yield* AutomationsRepository;
			const installations = yield* PluginInstallationRepository;

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
				archivedEvents: ValidatedArchiveEvents,
				pluginIdByKey: ReadonlyMap<string, string>,
				definitions: DefinitionSnapshot,
				required: ReadonlyArray<ArchiveRequiredPlugin>,
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
									relationshipSchemas: source.relationshipSchemas.filter(notSystemOwned(systemIds)),
								},
								archivedCandidates,
							),
						),
				});
				yield* preflightProvenance(
					records,
					archivedEvents,
					pluginIdByKey,
					archivedDefinitions,
					required,
				);
				return yield* preflightProvenance(
					records,
					archivedEvents,
					pluginIdByKey,
					definitions,
					currentContracts,
				);
			});

			const resolveProvider = Effect.fn(function* (
				pluginIdByKey: ReadonlyMap<string, string>,
				provider: { readonly pluginKey: string; readonly providerSlug: string } | null,
			) {
				if (!provider) {
					return null;
				}
				const pluginId = pluginIdByKey.get(provider.pluginKey);
				const resolved = pluginId
					? yield* plugins.resolveProviderBySlugs({ pluginId, providerSlug: provider.providerSlug })
					: null;
				return resolved ?? (yield* badRequest("Backup requires an unavailable provider"));
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

			const restoreRecords = Effect.fn("BackupRestoreWriter.restoreRecords")(function* (
				userId: UserId,
				records: ArchiveRecords,
				assetLocators: ReadonlyMap<string, AssetLocator>,
				archivedEvents: ValidatedArchiveEvents,
				pluginIdByKey: ReadonlyMap<string, string>,
				definitions: DefinitionSnapshot,
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
				const installationIdByKey = new Map<string, string>();
				const installationIdById = new Map<string, string>();
				const customViewIds = new Map(
					records.savedViews
						.filter((view) => view.kind === "custom")
						.map((view) => [view.id, SavedViewId.make(crypto.randomUUID())]),
				);
				const privateKeys = new Set(records.privatePlugins.map(({ key }) => key));
				const systemPackageIds = new Set(
					systemPlugins.map((plugin) => plugin.manifest.metadata.packageId),
				);
				const installationActivations: Array<{
					readonly id: string;
					readonly updatedAt: Date;
					readonly isHidden: boolean;
					readonly health: "ready" | "needs-configuration" | "incompatible";
					readonly healthReason: string | null;
					readonly incompatibilityReason: ArchiveInstallation["incompatibilityReason"];
				}> = [];
				const pluginKeyById = new Map([...pluginIdByKey].map(([key, id]) => [id, key]));
				for (const plugin of privatePlugins) {
					const key = pluginKeyById.get(plugin.id);
					if (key !== undefined) {
						privateKeys.add(key);
					}
				}
				for (const state of records.installations) {
					const pluginId = pluginIdByKey.get(state.packageKey);
					const installedPlugin = pluginId ? installedPlugins.get(pluginId) : undefined;
					if (!pluginId || !installedPlugin || installationIdByKey.has(state.packageKey)) {
						return yield* badRequest("Backup plugin installation mapping is invalid");
					}
					const config = yield* rewriteManagedAssetLocators(
						decodeArchiveJsonObject(state.config),
						installedPlugin.configSchema,
						assetLocators,
					).pipe(Effect.mapError(archiveReferenceError));
					const userSettings = yield* resolveRestoredPluginUserSettings(
						state.userSettings,
						installedPlugin.userSettingsSchema,
					);
					const isSystemPackage = !privateKeys.has(state.packageKey);
					const redactedConfigNeedsConfiguration = isSystemPackage
						? false
						: (yield* validateRestoredProperties(
								config,
								installedPlugin.configSchema,
								state.configuredSecretPaths,
								state.lifecycleIntent === "needs-configuration" ||
									state.lifecycleIntent === "incompatible",
							)).needsConfiguration;
					const lifecycle = resolveRestoredInstallationLifecycle(
						state,
						installedPlugin.configSchema,
						redactedConfigNeedsConfiguration,
						!isSystemPackage &&
							records.privatePlugins.some(
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
					installationIdById.set(state.id, restored.id);
					installationActivations.push({
						id: restored.id,
						...lifecycle,
						updatedAt: parseDate(state.updatedAt),
					});
				}
				const getEntitySchema = (slug: string, key: string | null) =>
					Effect.map(
						mappedOwner(pluginIdByKey, key),
						(owner) => definitions.entitySchemas[definitionKey("entity", owner, slug)],
					);
				const getRelationshipSchema = (slug: string, key: string | null) =>
					Effect.map(
						mappedOwner(pluginIdByKey, key),
						(owner) => definitions.relationshipSchemas[definitionKey("relationship", owner, slug)],
					);
				for (const integration of records.integrations) {
					const pluginId =
						integration.packageKey === null ? undefined : pluginIdByKey.get(integration.packageKey);
					const plugin = pluginId ? installedPlugins.get(pluginId) : undefined;
					const provider =
						integration.packageKey === null
							? { settingsSchema: dataJsonIntegrationSettingsSchema }
							: plugin?.integrationProviders.find(
									(definition) =>
										definition.slug === integration.provider && definition.lot === integration.lot,
								);
					let pluginInstallationId: string | null | undefined;
					if (integration.packageKey === null) {
						pluginInstallationId = null;
					} else if (integration.installationId === null) {
						pluginInstallationId = undefined;
					} else {
						pluginInstallationId = installationIdById.get(integration.installationId);
					}
					if (
						!provider ||
						pluginInstallationId === undefined ||
						(integration.packageKey !== null && !plugin)
					) {
						return yield* badRequest("Backup integration mapping is invalid");
					}
					const providerSpecifics = yield* rewriteManagedAssetLocators(
						decodeArchiveJsonObject(integration.providerSpecifics),
						provider.settingsSchema,
						assetLocators,
					).pipe(Effect.mapError(archiveReferenceError));
					yield* validateProperties(
						providerSpecifics,
						provider.settingsSchema,
						"Integration settings",
					);
					yield* persistence.restoreForUser({
						userId,
						providerSpecifics,
						lot: integration.lot,
						pluginInstallationId,
						name: integration.name,
						id: crypto.randomUUID(),
						provider: integration.provider,
						extraSettings: integration.extraSettings,
						syncOwnership: integration.syncOwnership,
						createdAt: parseDate(integration.createdAt),
						updatedAt: parseDate(integration.updatedAt),
						minimumProgress: integration.minimumProgress,
						maximumProgress: integration.maximumProgress,
						isDisabled: resolveRestoredIntegrationDisabled(integration, provider.settingsSchema),
						lastFinishedAt: integration.lastFinishedAt
							? parseDate(integration.lastFinishedAt)
							: null,
					});
				}
				const entityIdMap = new Map<string, EntityId>();
				const relationshipIdMap = new Map<string, string>(
					records.relationships.map(({ id }) => [id, crypto.randomUUID()]),
				);
				const entitySchemaById = new Map<EntityId, EntitySchemaSlug>();
				const rewriteProperties = (
					properties: Record<string, unknown>,
					propertiesSchema: AppSchema,
				) =>
					Effect.gen(function* () {
						const references = yield* rewritePropertyReferences(
							decodeArchiveJsonObject(properties),
							propertiesSchema,
							entityIdMap,
							relationshipIdMap,
						);
						return yield* rewriteManagedAssetLocators(references, propertiesSchema, assetLocators);
					}).pipe(Effect.mapError(archiveReferenceError));
				const bootstrapMappings = yield* resolveBootstrapEntityMappings(
					records.entities,
					yield* entities.listUserEntitiesForBackup(userId),
					pluginIdByKey,
				);
				for (const entity of records.entities) {
					entityIdMap.set(
						entity.id,
						bootstrapMappings.get(entity.id) ?? EntityId.make(crypto.randomUUID()),
					);
				}
				const dependencyTargets = new Map<
					string,
					Effect.Success<ReturnType<typeof entities.findGlobalEntityForRestore>>
				>();
				for (const dependency of records.entityDependencies) {
					const pluginId =
						dependency.entitySchemaPluginKey === null
							? null
							: pluginIdByKey.get(dependency.entitySchemaPluginKey);
					if (
						pluginId === undefined ||
						(pluginId !== null && !systemPlugins.some((plugin) => plugin.id === pluginId))
					) {
						return yield* badRequest("Backup global dependency requires verified system ownership");
					}
					const exact =
						dependency.identity.kind === "unmanaged"
							? yield* entities.findGlobalEntityById(EntityId.make(dependency.id))
							: null;
					if (
						dependency.identity.kind === "unmanaged" &&
						(!exact ||
							exact.entitySchemaSlug !== dependency.entitySchemaSlug ||
							exact.entitySchemaPluginId !== pluginId)
					) {
						return yield* badRequest(
							"Backup unmanaged dependency does not match a current registry identity",
						);
					}
					let target:
						| typeof exact
						| Effect.Success<ReturnType<typeof entities.findGlobalEntityForRestore>> = exact;
					if (dependency.identity.kind !== "unmanaged") {
						if (dependency.externalId === null) {
							target = null;
						} else {
							target = yield* entities.findGlobalEntityForRestore({
								entitySchemaPluginId: pluginId,
								externalId: dependency.externalId,
								entitySchemaSlug: EntitySchemaSlug.make(dependency.entitySchemaSlug),
								provider:
									dependency.provider === null
										? null
										: {
												slug: dependency.provider.providerSlug,
												owner: definitionOwner(
													pluginId ??
														(yield* badRequest("Backup provider requires a system owner")),
												),
											},
							});
						}
					}
					dependencyTargets.set(dependency.id, target);
					entityIdMap.set(dependency.id, target?.id ?? EntityId.make(dependency.id));
				}
				for (const dependency of records.entityDependencies) {
					const schemaDefinition = yield* getEntitySchema(
						dependency.entitySchemaSlug,
						dependency.entitySchemaPluginKey,
					);
					if (!schemaDefinition) {
						return yield* badRequest("Backup references an unavailable entity schema");
					}
					yield* assertDependencySchemaOwnership(
						dependency,
						schemaDefinition.pluginId
							? (pluginKeyById.get(schemaDefinition.pluginId) ?? null)
							: null,
					);
					const entitySchemaSlug = EntitySchemaSlug.make(dependency.entitySchemaSlug);
					const entitySchemaPluginId = dependency.entitySchemaPluginKey
						? (pluginIdByKey.get(dependency.entitySchemaPluginKey) ?? null)
						: null;
					let target = dependencyTargets.get(dependency.id) ?? null;
					let inserted = false;
					let provider = null;
					if (dependency.identity.kind === "provider") {
						const archivedProvider = dependency.provider;
						if (dependency.externalId === null || archivedProvider === null) {
							return yield* badRequest("Backup global dependency is missing its natural identity");
						}
						provider = yield* resolveProvider(pluginIdByKey, archivedProvider);
					}
					if (!target) {
						const properties = yield* rewriteProperties(
							dependency.properties,
							schemaDefinition.propertiesSchema,
						);
						yield* validateProperties(
							properties,
							schemaDefinition.propertiesSchema,
							"Entity properties",
						);
						yield* lockAssetReferences([
							{
								properties,
								ownerUserId: null,
								propertiesSchema: schemaDefinition.propertiesSchema,
							},
						]).pipe(Effect.catchTag("ManagedAssetReferenceRejected", assetForbidden));
						const id = yield* persistence.restoreEntity({
							properties,
							userId: null,
							id: dependency.id,
							entitySchemaPluginId,
							name: dependency.name,
							providerId: provider?.id ?? null,
							externalId: dependency.externalId,
							createdAt: parseDate(dependency.createdAt),
							updatedAt: parseDate(dependency.updatedAt),
							entitySchemaSlug: dependency.entitySchemaSlug,
							populatedAt: dependency.populatedAt ? parseDate(dependency.populatedAt) : null,
						});
						target = { id, entitySchemaSlug, entitySchemaPluginId };
						inserted = true;
					}
					entityIdMap.set(dependency.id, target.id);
					entitySchemaById.set(target.id, target.entitySchemaSlug);
					for (const translation of selectTranslationsForRestore(
						inserted,
						dependency.translations,
					)) {
						const properties =
							translation.properties === null
								? null
								: yield* rewriteProperties(
										translation.properties,
										schemaDefinition.propertiesSchema,
									);
						if (properties !== null) {
							yield* lockAssetReferences([
								{
									properties,
									ownerUserId: null,
									propertiesSchema: schemaDefinition.propertiesSchema,
								},
							]).pipe(Effect.catchTag("ManagedAssetReferenceRejected", assetForbidden));
						}
						yield* persistence.restoreTranslation({
							properties,
							entityId: target.id,
							name: translation.name,
							language: translation.language,
							createdAt: parseDate(translation.createdAt),
							updatedAt: parseDate(translation.updatedAt),
							populatedAt: translation.populatedAt ? parseDate(translation.populatedAt) : null,
						});
					}
				}

				for (const entity of records.entities) {
					const mappedId = entityIdMap.get(entity.id);
					if (!mappedId) {
						return yield* badRequest("Backup entity mapping is incomplete");
					}
					if (bootstrapMappings.has(entity.id)) {
						entitySchemaById.set(mappedId, EntitySchemaSlug.make(entity.entitySchemaSlug));
						continue;
					}
					const provider = yield* resolveProvider(pluginIdByKey, entity.provider);
					const propertiesSchema = (yield* getEntitySchema(
						entity.entitySchemaSlug,
						entity.entitySchemaPluginKey,
					))?.propertiesSchema;
					if (!propertiesSchema) {
						return yield* badRequest("Backup references an unavailable entity schema");
					}
					const properties = yield* rewriteProperties(entity.properties, propertiesSchema);
					yield* validateProperties(properties, propertiesSchema, "Entity properties");
					const id = yield* persistence.restoreEntity({
						userId,
						properties,
						id: mappedId,
						name: entity.name,
						externalId: entity.externalId,
						providerId: provider?.id ?? null,
						createdAt: parseDate(entity.createdAt),
						updatedAt: parseDate(entity.updatedAt),
						entitySchemaSlug: entity.entitySchemaSlug,
						populatedAt: entity.populatedAt ? parseDate(entity.populatedAt) : null,
						entitySchemaPluginId: entity.entitySchemaPluginKey
							? (pluginIdByKey.get(entity.entitySchemaPluginKey) ?? null)
							: null,
					});
					entityIdMap.set(entity.id, id);
					entitySchemaById.set(id, EntitySchemaSlug.make(entity.entitySchemaSlug));
				}

				for (const relationship of records.relationships) {
					if (relationship.scope !== "user") {
						return yield* badRequest("Backup contains a non-user relationship");
					}
					const rewritten = yield* rewriteRelationshipReferences(relationship, entityIdMap);
					const sourceEntityId = EntityId.make(rewritten.sourceEntityId);
					const targetEntityId = EntityId.make(rewritten.targetEntityId);
					const propertiesSchema = (yield* getRelationshipSchema(
						relationship.relationshipSchemaSlug,
						relationship.relationshipSchemaPluginKey,
					))?.propertiesSchema;
					if (!propertiesSchema) {
						return yield* badRequest("Backup references an unavailable relationship schema");
					}
					const properties = yield* rewriteProperties(relationship.properties, propertiesSchema);
					yield* validateProperties(properties, propertiesSchema, "Relationship properties");
					const restoredId = yield* persistence.restoreRelationship({
						userId,
						properties,
						sourceEntityId,
						targetEntityId,
						createdAt: parseDate(relationship.createdAt),
						relationshipSchemaSlug: relationship.relationshipSchemaSlug,
						id:
							relationshipIdMap.get(relationship.id) ??
							(yield* badRequest("Backup relationship mapping is incomplete")),
						relationshipSchemaPluginId: relationship.relationshipSchemaPluginKey
							? (pluginIdByKey.get(relationship.relationshipSchemaPluginKey) ?? null)
							: null,
					});
					relationshipIdMap.set(relationship.id, restoredId);
				}

				const eventBatch: Parameters<typeof restoreEventBatch>[0][number][] = [];
				yield* Stream.runForEach(archivedEvents.read(), (event) =>
					Effect.gen(function* () {
						const entityId = entityIdMap.get(event.entityId);
						if (!entityId) {
							return yield* badRequest("Backup event references an unknown entity");
						}
						const entitySchemaSlug = entitySchemaById.get(entityId);
						if (!entitySchemaSlug) {
							return yield* badRequest("Backup event references an unknown entity schema");
						}
						const propertiesSchema = (yield* getEntitySchema(
							entitySchemaSlug,
							event.eventSchemaPluginKey,
						))?.eventSchemas[event.eventSchemaSlug]?.propertiesSchema;
						if (!propertiesSchema) {
							return yield* badRequest("Backup references an unavailable event schema");
						}
						const rewritten = yield* rewriteEventReferences(
							event,
							propertiesSchema,
							entityIdMap,
							relationshipIdMap,
						);
						const sessionEntityId = rewritten.sessionEntityId
							? EntityId.make(rewritten.sessionEntityId)
							: null;
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
							sessionEntityId,
							createdAt: parseDate(event.createdAt),
							updatedAt: parseDate(event.updatedAt),
							eventSchemaSlug: event.eventSchemaSlug,
							occurredAt: parseDate(event.occurredAt),
							id: sha256Hex(identityTupleKey("backup-event", userId, event.id)),
							eventSchemaPluginId: event.eventSchemaPluginKey
								? (pluginIdByKey.get(event.eventSchemaPluginKey) ?? null)
								: null,
						});
						return yield* eventBatch.length >= RESTORE_EVENT_BATCH_SIZE
							? restoreEventBatch(eventBatch.splice(0))
							: Effect.void;
					}),
				);
				yield* restoreEventBatch(eventBatch.splice(0));

				if (!(yield* persistence.restorePortableProfile(userId, records.profile))) {
					return yield* badRequest("Backup user does not exist");
				}
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
						view.installationId === null ? null : installationIdById.get(view.installationId);
					if (view.installationId !== null && !pluginInstallationId) {
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
					const settings = yield* importRendererSettings(
						view.renderer,
						view.settings,
						pluginIdByKey,
					);
					yield* validateSavedViewDefinition(
						renderer,
						settings,
						dataSources,
						null,
						pluginPage?.kind === "page" ? pluginPage : null,
					).pipe(Effect.mapError(() => badRequest("Backup saved view definition is invalid")));
					if (pluginPage?.kind === "page") {
						yield* lockAssetReferences([
							{
								ownerUserId: userId,
								properties: settings,
								propertiesSchema: pluginPage.settingsSchema,
							},
						]).pipe(Effect.catchTag("ManagedAssetReferenceRejected", assetForbidden));
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
							customViewIds.get(view.id) ??
							(yield* badRequest("Backup custom view mapping is incomplete")),
					});
					if (!restored) {
						return yield* badRequest("Backup saved view could not be restored");
					}
				}
				for (const state of records.installations) {
					if (state.homeSavedView === null) {
						continue;
					}
					const installationId = installationIdById.get(state.id);
					const home = state.homeSavedView;
					let reference: SavedViewReference;
					if (home.kind === "custom") {
						const id = customViewIds.get(home.savedViewId);
						if (!id) {
							return yield* badRequest("Backup home custom view mapping is incomplete");
						}
						reference = { kind: "custom", savedViewId: id };
					} else if (home.kind === "plugin") {
						const id = pluginIdByKey.get(home.pluginKey);
						if (!id) {
							return yield* badRequest("Backup home plugin mapping is incomplete");
						}
						reference = { kind: "plugin", slug: home.slug, pluginId: PluginId.make(id) };
					} else {
						reference = home;
					}
					if (
						!installationId ||
						!(yield* installations.setHomeSavedView(userId, installationId, reference))
					) {
						return yield* badRequest("Backup installation home saved view could not be restored");
					}
				}
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
						yield* automations.insertNotificationSubscription({
							userId,
							metadata: null,
							isActive: true,
							signalSchemaPluginId: definition.pluginId,
							signalSchemaSlug: SignalSchemaSlug.make(definition.slug),
						});
					}
				}
				for (const subscription of records.notificationSubscriptions) {
					const definition =
						definitions.signalSchemas[
							definitionKey(
								"signal",
								yield* mappedOwner(pluginIdByKey, subscription.signalSchemaPluginKey),
								subscription.signalSchemaSlug,
							)
						];
					if (!definition) {
						return yield* badRequest("Backup references an unavailable notification subscription");
					}
					const restored = yield* persistence.restoreNotificationSubscription({
						userId,
						isActive: subscription.isActive,
						signalSchemaSlug: SignalSchemaSlug.make(subscription.signalSchemaSlug),
						signalSchemaPluginId: subscription.signalSchemaPluginKey
							? (pluginIdByKey.get(subscription.signalSchemaPluginKey) ?? null)
							: null,
						metadata:
							subscription.metadata && isArchiveJsonObject(subscription.metadata)
								? yield* rewriteProperties(subscription.metadata, definition.propertiesSchema)
								: subscription.metadata,
					});
					if (!restored) {
						return yield* badRequest("Backup target is missing a notification subscription");
					}
				}
				for (const activation of installationActivations) {
					if (!(yield* persistence.activateRestored(activation))) {
						return yield* badRequest("Backup plugin installation could not be activated");
					}
				}
				return undefined;
			});

			return { preflight, restoreRecords, assertRequiredPlugins };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(BackupRestorePersistence.layer),
	);
}
