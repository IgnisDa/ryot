import { badRequest } from "@ryot-app/contract/errors";
import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	builtinSavedViewId,
	definitionKey,
	definitionOwner,
	pluginPackageKey,
	savedViewReferenceKey,
} from "@ryot-app/contract/modules/plugins/references";
import {
	type BackupRunId,
	EntityId,
	EventId,
	type PublicationId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { PluginClientArtifact } from "@ryot-app/plugin-client-contract";
import { Context, Effect, FileSystem, Layer, Schema } from "effect";

import {
	collectManagedAssetLocatorsInto,
	managedAssetLocatorKey,
	sortedManagedAssetLocators,
} from "#lib/domain/managed-asset-locators";
import { AuthRepository } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { AutomationsRepository } from "#modules/automations/repository";
import {
	collectEmbeddedEntityIds,
	type DataReferenceError,
	rewriteManagedAssetLocators,
} from "#modules/backups/data-references";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { DefinitionRepository } from "#modules/definitions/repository";
import { buildDefinitionSnapshot, type DefinitionSnapshot } from "#modules/definitions/snapshot";
import { mergeManifestDefinitions } from "#modules/definitions/source";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { type BackupExcludedEventSchema, EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { resolveIntegrationSettingsSchema } from "#modules/integrations/settings-schema";
import { concretePluginConfigSecretPaths } from "#modules/plugins/configuration/redaction";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { ARCHIVE_LIMITS } from "../archive/archive";
import { archiveEntryTooLarge, archiveError, BackupArchiveError } from "../archive/error";
import {
	collectReferencedPluginKeys,
	escapePointer,
	exportQueryPluginReferences,
	exportRendererSettings,
	redactSchemaSecrets,
	rewriteAssetLocatorForArchive,
} from "../archive/references";
import type {
	ArchiveCalendarSourceOverride,
	ArchiveEntityDependency,
	ArchiveEvent,
	ArchiveInstallation,
	ArchiveIntegration,
	ArchiveNotificationSubscription,
	ArchivePublication,
	ArchiveRecords,
	ArchiveRelationship,
	ArchiveReminder,
	ArchiveSavedView,
	ArchiveUserEntity,
} from "../archive/schemas";
import {
	ARCHIVE_CODECS,
	ARCHIVE_SECTION_PATHS,
	archivePluginDefinitionContract,
	decodeArchiveJsonObject,
	isArchiveJsonObject,
} from "../archive/schemas";
import type { ArchiveMetadata, StreamedSectionPath } from "../archive/sections";
import { encodeArchiveJsonLine, encodeNdjson, IncrementalSha256 } from "../archive/streaming";
import { isDefaultSystemInstallation } from "../installation-state";
import { BackupStaging } from "../staging";
import { BackupExportRepository, type BackupPropertyReferenceDeclaration } from "./repository";

type ExportCursors = {
	views: string | undefined;
	entities: string | undefined;
	reminders: string | undefined;
	foldValues: string | undefined;
	dependencies: string | undefined;
	integrations: string | undefined;
	relationships: string | undefined;
	subscriptions: string | undefined;
	publications: undefined | PublicationId;
	calendar: undefined | { slug: string; pluginId: string };
	viewOverrides: undefined | { slug: string; pluginId: null | string };
};

const emptyCursors = (): ExportCursors => ({
	views: undefined,
	entities: undefined,
	calendar: undefined,
	reminders: undefined,
	foldValues: undefined,
	dependencies: undefined,
	integrations: undefined,
	publications: undefined,
	relationships: undefined,
	subscriptions: undefined,
	viewOverrides: undefined,
});
const pluginRecordLimit = ARCHIVE_LIMITS.maxPluginRecords;
const exportPageSize = 8;

type BackupPropertyRecord = {
	readonly propertiesSchema: AppSchema;
	readonly properties: Record<string, unknown>;
};

const archiveReferenceError = (error: DataReferenceError) =>
	archiveError(error.code, error.message);

const propertyEntityReferencePaths = (
	property: AppPropertyDefinition,
	path: string,
): Array<string> => {
	if (property.secret === true) {
		return [];
	}
	if (property.type === "string" && property.reference?.kind === "entity-id") {
		return [path];
	}
	if (property.type === "object") {
		return Object.entries(property.properties).flatMap(([field, child]) =>
			propertyEntityReferencePaths(child, `${path}.${JSON.stringify(field)}`),
		);
	}
	if (property.type === "array") {
		return propertyEntityReferencePaths(property.items, `${path}[*]`);
	}
	return [];
};

export const eventEntityReferencePaths = (propertiesSchema: AppSchema) =>
	Object.entries(propertiesSchema.fields).flatMap(([field, property]) =>
		propertyEntityReferencePaths(property, `lax $.${JSON.stringify(field)}`),
	);

type BackupEventPage = {
	readonly nextAfterId: null | EventId;
	readonly records: ReadonlyArray<ArchiveEvent>;
	readonly schemas: ReadonlyMap<
		string,
		{ readonly slug: string; readonly pluginId: null | string }
	>;
};

const concatEncoded = (chunks: Iterable<Uint8Array>) => {
	const values = [...chunks];
	const output = new Uint8Array(values.reduce((size, chunk) => size + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of values) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
};

const installationLifecycleIntent = (health: string, isHidden: boolean) => {
	if (health === "incompatible") {
		return "incompatible" as const;
	}
	if (health !== "ready") {
		return "needs-configuration" as const;
	}
	return isHidden ? ("hidden" as const) : ("ready" as const);
};

export const requireNotificationMetadataSchema = Effect.fn(function* (
	subscription: ArchiveNotificationSubscription,
	propertiesSchema: AppSchema | undefined,
) {
	if (subscription.metadata !== null && !propertiesSchema) {
		return yield* badRequest(
			`Backup references unavailable signal schema '${subscription.signalSchemaSlug}'`,
		);
	}
	return propertiesSchema;
});

export const requirePluginKey = Effect.fn("BackupExportSnapshot.requirePluginKey")(function* (
	pluginKeyById: ReadonlyMap<string, string>,
	pluginId: string,
) {
	const key = pluginKeyById.get(pluginId);
	return key ?? (yield* badRequest(`Backup references unavailable plugin '${pluginId}'`));
});

export const definitionForPlugin = <
	Definition extends { readonly pluginId?: null | string | undefined },
>(
	definition: undefined | Definition,
	pluginId: null | string | undefined,
	historical?: Definition,
) => {
	if ((definition?.pluginId ?? null) === pluginId) {
		return definition;
	}
	return (historical?.pluginId ?? null) === pluginId ? historical : undefined;
};

const privateDefinitionSnapshot = (plugin: {
	readonly id: string;
	readonly manifest: PluginManifest;
}): DefinitionSnapshot =>
	buildDefinitionSnapshot(
		mergeManifestDefinitions(
			{
				savedViews: [],
				entitySchemas: [],
				signalSchemas: [],
				calendarSources: [],
				relationshipSchemas: [],
			},
			[plugin],
		),
	);

const privateDefinitionSnapshots = (
	plugins: ReadonlyArray<{ readonly id: string; readonly manifest: PluginManifest }>,
) => new Map(plugins.map((plugin) => [plugin.id, privateDefinitionSnapshot(plugin)]));

const definitionLookup =
	<Definition extends { readonly pluginId?: null | string | undefined }>(
		kind: string,
		current: Readonly<Record<string, Definition>>,
		historical: (pluginId: string) => undefined | Readonly<Record<string, Definition>>,
	) =>
	(slug: string, pluginId: null | string | undefined) =>
		definitionForPlugin(
			current[definitionKey(kind, definitionOwner(pluginId ?? null), slug)],
			pluginId,
			pluginId
				? historical(pluginId)?.[definitionKey(kind, definitionOwner(pluginId), slug)]
				: undefined,
		);

const definitionLookups = (
	definitions: DefinitionSnapshot,
	historical: ReadonlyMap<string, DefinitionSnapshot>,
) => ({
	savedView: definitionLookup(
		"saved-view",
		definitions.savedViews,
		(id) => historical.get(id)?.savedViews,
	),
	entitySchema: definitionLookup(
		"entity",
		definitions.entitySchemas,
		(id) => historical.get(id)?.entitySchemas,
	),
	signalSchema: definitionLookup(
		"signal",
		definitions.signalSchemas,
		(id) => historical.get(id)?.signalSchemas,
	),
	calendarSource: definitionLookup(
		"calendar-source",
		definitions.calendarSources,
		(id) => historical.get(id)?.calendarSources,
	),
	relationshipSchema: definitionLookup(
		"relationship",
		definitions.relationshipSchemas,
		(id) => historical.get(id)?.relationshipSchemas,
	),
});

const storedJsonObject = (value: unknown) => decodeArchiveJsonObject(value).pipe(Effect.orDie);

const toArchiveEntity = Effect.fn(function* (
	entity: PortableEntityRecord,
	pluginKeyById: ReadonlyMap<string, string>,
) {
	if (entity.provider && entity.provider.pluginId !== entity.entitySchemaPluginId) {
		return yield* badRequest("Backup entity provider has the wrong schema owner");
	}
	return {
		id: entity.id,
		name: entity.name,
		externalId: entity.externalId,
		createdAt: entity.createdAt.toISOString(),
		updatedAt: entity.updatedAt.toISOString(),
		entitySchemaSlug: entity.entitySchemaSlug,
		populatedAt: entity.populatedAt?.toISOString() ?? null,
		properties: yield* storedJsonObject(entity.properties),
		entitySchemaPluginKey: entity.entitySchemaPluginId
			? yield* requirePluginKey(pluginKeyById, entity.entitySchemaPluginId)
			: null,
		provider: entity.provider
			? {
					providerSlug: entity.provider.providerSlug,
					pluginKey: yield* requirePluginKey(pluginKeyById, entity.provider.pluginId),
				}
			: null,
	} satisfies ArchiveUserEntity;
});

const dependencyIdentity = Effect.fn(function* (
	entity: PortableEntityRecord,
	pluginKeyById: ReadonlyMap<string, string>,
) {
	if (entity.provider) {
		return {
			kind: "provider",
			providerSlug: entity.provider.providerSlug,
			pluginKey: yield* requirePluginKey(pluginKeyById, entity.provider.pluginId),
		} satisfies ArchiveEntityDependency["identity"];
	}
	if (entity.externalId && entity.entitySchemaPluginId) {
		return {
			kind: "bootstrap",
			externalId: entity.externalId,
			entitySchemaSlug: entity.entitySchemaSlug,
			pluginKey: yield* requirePluginKey(pluginKeyById, entity.entitySchemaPluginId),
		} satisfies ArchiveEntityDependency["identity"];
	}
	return { kind: "unmanaged" } satisfies ArchiveEntityDependency["identity"];
});

const transientEvidenceSchemas = (context: {
	readonly definitionSnapshots: ReadonlyArray<DefinitionSnapshot>;
}): ReadonlyArray<BackupExcludedEventSchema> => {
	const schemas = new Map<string, BackupExcludedEventSchema>();
	for (const snapshot of context.definitionSnapshots) {
		for (const entitySchema of Object.values(snapshot.entitySchemas)) {
			for (const { transient, eventSchema } of entitySchema.userState?.evidence ?? []) {
				if (transient) {
					const excluded = {
						slug: eventSchema.slug,
						entitySchemaSlug: eventSchema.entitySchemaSlug,
						pluginId: eventSchema.owner.kind === "kernel" ? null : entitySchema.pluginId,
					};
					schemas.set(JSON.stringify(excluded), excluded);
				}
			}
		}
	}
	return [...schemas.values()];
};

export class BackupExportSnapshot extends Context.Service<BackupExportSnapshot>()(
	"@ryot-app/kernel-backend/modules/backups/export/snapshot/BackupExportSnapshot",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthRepository;
			const events = yield* EventsRepository;
			const fs = yield* FileSystem.FileSystem;
			const plugins = yield* PluginRepository;
			const entities = yield* EntitiesRepository;
			const uploads = yield* ManagedAssetsService;
			const definitionRepository = yield* DefinitionRepository;
			const savedViews = yield* SavedViewsRepository;
			const automations = yield* AutomationsRepository;
			const integrations = yield* IntegrationsRepository;
			const relationships = yield* RelationshipsRepository;
			const installations = yield* PluginInstallationRepository;
			const exportRepository = yield* BackupExportRepository;
			const staging = yield* BackupStaging;

			const readExportContext = Effect.fn("BackupExportSnapshot.readExportContext")(function* (
				userId: UserId,
				definitions: DefinitionSnapshot,
			) {
				const systemPlugins = yield* plugins.listActiveSystemPlugins(pluginRecordLimit + 1);
				const privatePlugins = yield* plugins.listPrivateForUser(userId, pluginRecordLimit + 1);
				if (systemPlugins.length + privatePlugins.length > pluginRecordLimit) {
					return yield* archiveError(
						"count_mismatch",
						"Backup plugin metadata record limit exceeded",
						"private-plugins.ndjson",
					);
				}
				const installedPlugins = [...systemPlugins, ...privatePlugins].map((plugin) => ({
					id: plugin.id,
					scope: plugin.scope,
					manifest: plugin.manifest,
					client: plugin.manifest.client,
					contentHash: plugin.contentHash,
					metadata: plugin.manifest.metadata,
					providers: plugin.manifest.providers,
					version: plugin.manifest.metadata.version,
					configSchema: plugin.manifest.configSchema,
					packageId: plugin.manifest.metadata.packageId,
					userSettingsSchema: plugin.manifest.userSettingsSchema,
					integrationProviders: plugin.manifest.integrationProviders,
					signalSchemaSlugs: plugin.manifest.signalSchemas.map(({ slug }) => slug),
					relationshipSchemaSlugs: plugin.manifest.relationshipSchemas.map(({ slug }) => slug),
				}));
				const pluginByKey = new Map(
					installedPlugins.map((plugin) => [pluginPackageKey(plugin), plugin]),
				);
				const pluginKeyById = new Map(
					installedPlugins.map((plugin) => [plugin.id, pluginPackageKey(plugin)]),
				);
				return {
					pluginByKey,
					pluginKeyById,
					privatePlugins,
					installedPlugins,
					pluginIdForKey: (pluginKey: null | string) =>
						pluginKey ? pluginByKey.get(pluginKey)?.id : null,
					definitionSnapshots: [
						definitions,
						...privateDefinitionSnapshots(privatePlugins).values(),
					],
					...definitionLookups(definitions, privateDefinitionSnapshots(privatePlugins)),
				};
			});

			type BackupExportContext = Effect.Success<ReturnType<typeof readExportContext>>;

			const readExportData = Effect.fn("BackupExportSnapshot.readExportData")(function* (
				userId: UserId,
				context: BackupExportContext,
				runId: BackupRunId,
				cursors: ExportCursors,
				includeMetadata: boolean,
			) {
				const profile = yield* auth.getPortableProfile(userId);
				if (!profile) {
					return yield* badRequest("Backup user does not exist");
				}
				const allStoredInstallations = yield* installations.listHydratedForUser(
					userId,
					pluginRecordLimit + 1,
				);
				if (allStoredInstallations.length > pluginRecordLimit) {
					return yield* archiveError(
						"count_mismatch",
						"Backup installation metadata record limit exceeded",
						"installations.ndjson",
					);
				}
				const { pluginKeyById, privatePlugins, installedPlugins } = context;
				const getEntitySchema = (entity: PortableEntityRecord) =>
					context.entitySchema(entity.entitySchemaSlug, entity.entitySchemaPluginId);
				const installedPluginIds = new Set(installedPlugins.map(({ id }) => id));
				const storedInstallations = allStoredInstallations.filter(({ pluginId }) =>
					installedPluginIds.has(pluginId),
				);
				const userEntities = yield* entities.listUserEntitiesForBackup(userId, {
					limit: exportPageSize,
					afterId: cursors.entities,
				});
				const dependencyRows = yield* staging.listRecords(
					runId,
					"entity-dependencies.ndjson",
					cursors.dependencies,
					exportPageSize,
				);
				const dependencies = yield* entities.listGlobalEntitiesByIdsForBackup(
					dependencyRows.map(({ id }) => EntityId.make(id)),
				);
				const privatePluginIds = new Set(privatePlugins.map(({ id }) => id));
				if (
					dependencies.some(
						({ entitySchemaPluginId }) =>
							entitySchemaPluginId !== null && privatePluginIds.has(entitySchemaPluginId),
					)
				) {
					return yield* badRequest(
						"Backup private entity cannot be exported as a global dependency",
					);
				}
				const storedRelationships = yield* relationships.listUserRelationshipsForBackup(userId, {
					limit: exportPageSize,
					afterId: cursors.relationships,
				});
				const storedIntegrations = yield* integrations.listForBackup(userId, {
					limit: exportPageSize,
					afterId: cursors.integrations,
				});
				const storedViews = yield* savedViews.listForBackup(userId, {
					limit: exportPageSize,
					afterId: cursors.views,
				});
				const storedReminders = yield* exportRepository.listReminders(userId, {
					limit: exportPageSize,
					afterId: cursors.reminders,
				});
				const storedOverrides = yield* exportRepository.listSavedViewOverrides(userId, {
					limit: exportPageSize,
					after: cursors.viewOverrides,
				});
				const storedCalendarOverrides = yield* exportRepository.listCalendarSourceOverrides(
					userId,
					{ limit: exportPageSize, after: cursors.calendar },
				);
				const storedPublications = yield* exportRepository.listPublications(userId, {
					limit: exportPageSize,
					afterId: cursors.publications,
				});
				const storedFoldValues = yield* exportRepository.listFoldValues(userId, {
					limit: exportPageSize,
					after: cursors.foldValues,
				});
				const foldValueRecords = storedFoldValues.flatMap((row) => {
					const pluginKey = pluginKeyById.get(row.pluginId);
					return pluginKey === undefined
						? []
						: [{ pluginKey, value: row.value, entityId: row.entityId }];
				});
				const reminderRecords: ArchiveReminder[] = yield* Effect.forEach(storedReminders, (row) =>
					Schema.decodeUnknownEffect(ARCHIVE_CODECS["reminders.ndjson"])({
						id: row.id,
						state: row.state,
						reason: row.reason,
						message: row.message,
						outcome: row.outcome,
						entityId: row.entityId,
						timezone: row.timezone,
						entityTitle: row.entityTitle,
						replacementId: row.replacementId,
						parentEntityId: row.parentEntityId,
						originalSchedule: row.originalSchedule,
						createdAt: row.createdAt.toISOString(),
						updatedAt: row.updatedAt.toISOString(),
						dueAt: row.dueAt?.toISOString() ?? null,
						settledAt: row.settledAt?.toISOString() ?? null,
						processingAt: row.processingAt?.toISOString() ?? null,
					}).pipe(Effect.mapError(() => badRequest("Backup reminder data is invalid"))),
				);
				const storedSubscriptions = yield* automations.listNotificationSubscriptionsForBackup(
					userId,
					{ limit: exportPageSize, afterId: cursors.subscriptions },
				);
				const entityDependencies: ArchiveEntityDependency[] = yield* Effect.forEach(
					dependencies,
					(entity) =>
						Effect.gen(function* () {
							const identity = yield* dependencyIdentity(entity, pluginKeyById);
							const portable = yield* toArchiveEntity(entity, pluginKeyById);
							const reference = {
								id: portable.id,
								name: portable.name,
								provider: portable.provider,
								externalId: portable.externalId,
								entitySchemaSlug: portable.entitySchemaSlug,
								entitySchemaPluginKey: portable.entitySchemaPluginKey,
							};
							if (identity.kind === "bootstrap") {
								return {
									...reference,
									identity,
									kind: "bootstrap-reference",
									externalId: identity.externalId,
								} satisfies ArchiveEntityDependency;
							}
							if (
								identity.kind === "provider" &&
								entity.externalId !== null &&
								context.pluginByKey
									.get(identity.pluginKey)
									?.providers.some(
										(provider) =>
											provider.slug === identity.providerSlug &&
											provider.rootEntitySchemaSlug === entity.entitySchemaSlug,
									)
							) {
								return {
									...reference,
									identity,
									kind: "provider-reference",
									externalId: entity.externalId,
								} satisfies ArchiveEntityDependency;
							}
							return {
								...portable,
								identity,
								kind: "snapshot",
								translations: [],
							} satisfies ArchiveEntityDependency;
						}),
				);
				const relationshipRecords: ArchiveRelationship[] = yield* Effect.forEach(
					storedRelationships,
					(relationship) =>
						Effect.gen(function* () {
							return {
								scope: "user",
								id: relationship.id,
								sourceEntityId: relationship.sourceEntityId,
								targetEntityId: relationship.targetEntityId,
								createdAt: relationship.createdAt.toISOString(),
								relationshipSchemaSlug: relationship.relationshipSchemaSlug,
								properties: yield* storedJsonObject(relationship.properties),
								relationshipSchemaPluginKey: relationship.relationshipSchemaPluginId
									? yield* requirePluginKey(pluginKeyById, relationship.relationshipSchemaPluginId)
									: null,
							} satisfies ArchiveRelationship;
						}),
				);
				const homeSavedViews = new Set(
					allStoredInstallations.flatMap(({ homeSavedView }) =>
						homeSavedView === null ? [] : [savedViewReferenceKey(homeSavedView)],
					),
				);
				const portablePackages = new Map(
					installedPlugins.map((plugin) => [
						plugin.id,
						{ scope: plugin.scope, packageId: plugin.packageId },
					]),
				);
				const installationById = new Map(allStoredInstallations.map((state) => [state.id, state]));
				const requireInstallation = (installationId: null | string, message: string) => {
					if (installationId === null) {
						return Effect.succeed(null);
					}
					const installation = installationById.get(installationId);
					return installation ? Effect.succeed(installation) : badRequest(message);
				};
				const viewRecords: ArchiveSavedView[] = (yield* Effect.forEach(storedViews, (view) =>
					Effect.gen(function* () {
						const installation = yield* requireInstallation(
							view.pluginInstallationId,
							"Backup saved view references unavailable plugin installation",
						);
						const viewPluginId = installation?.pluginId ?? null;
						const definitionPluginId =
							view.isBuiltin && view.reference.kind === "plugin" ? view.reference.pluginId : null;
						const viewDefinition = context.savedView(view.slug, definitionPluginId);
						const referencePluginId = view.isBuiltin ? definitionPluginId : viewPluginId;
						const qualified = {
							pluginKey: referencePluginId
								? yield* requirePluginKey(pluginKeyById, referencePluginId)
								: null,
						};
						if (!view.isBuiltin) {
							const {
								reference: _reference,
								pluginInstallationId: _installationId,
								...portableView
							} = view;
							const renderer =
								view.renderer.kind === "plugin"
									? {
											kind: "plugin" as const,
											exportName: view.renderer.exportName,
											pluginKey: yield* requirePluginKey(pluginKeyById, view.renderer.pluginId),
										}
									: view.renderer;
							return [
								{
									...portableView,
									...qualified,
									renderer,
									kind: "custom" as const,
									isBuiltin: false as const,
									dataSources: yield* exportQueryPluginReferences(
										view.dataSources,
										portablePackages,
									),
									settings: yield* exportRendererSettings(
										view.renderer,
										view.settings,
										pluginKeyById,
									),
								},
							];
						}
						return viewDefinition &&
							view.sortOrder === viewDefinition.sortOrder &&
							!view.isHidden &&
							!homeSavedViews.has(savedViewReferenceKey(view.reference))
							? []
							: [
									{
										id: view.id,
										slug: view.slug,
										isHidden: view.isHidden,
										sortOrder: view.sortOrder,
										...qualified,
										isBuiltin: true as const,
										kind: "builtin-override" as const,
									},
								];
					}),
				)).flat();
				for (const override of storedOverrides) {
					if (!context.savedView(override.slug, override.pluginId)) {
						return yield* badRequest("Backup references an unavailable retained saved view");
					}
					viewRecords.push({
						isBuiltin: true,
						slug: override.slug,
						kind: "builtin-override",
						isHidden: override.isHidden,
						sortOrder: override.sortOrder,
						id: builtinSavedViewId(userId, definitionOwner(override.pluginId), override.slug),
						pluginKey:
							override.pluginId === null
								? null
								: yield* requirePluginKey(pluginKeyById, override.pluginId),
					});
				}
				const calendarSourceOverrideRecords: ArchiveCalendarSourceOverride[] = [];
				for (const override of storedCalendarOverrides) {
					const pluginKey = pluginKeyById.get(override.pluginId);
					if (!pluginKey || !context.calendarSource(override.slug, override.pluginId)) {
						continue;
					}
					calendarSourceOverrideRecords.push({
						pluginKey,
						slug: override.slug,
						isHidden: override.isHidden,
					});
				}
				const publicationRecords = storedPublications.flatMap((row): ArchivePublication[] => {
					const archived = {
						id: row.id,
						icon: row.icon,
						title: row.title,
						description: row.description,
						showOwnerName: row.showOwnerName,
						createdAt: row.createdAt.toISOString(),
					};
					if (row.source.kind === "collection") {
						return [{ ...archived, source: row.source }];
					}
					const reference = row.source.reference;
					if (reference.kind === "custom") {
						return [{ ...archived, source: { reference, kind: row.source.kind } }];
					}
					if (reference.kind === "kernel") {
						return context.savedView(reference.slug, null)
							? [{ ...archived, source: { reference, kind: row.source.kind } }]
							: [];
					}
					const pluginKey = pluginKeyById.get(reference.pluginId);
					return pluginKey && context.savedView(reference.slug, reference.pluginId)
						? [
								{
									...archived,
									source: {
										kind: row.source.kind,
										reference: { pluginKey, kind: reference.kind, slug: reference.slug },
									},
								},
							]
						: [];
				});
				const subscriptionRecords: ArchiveNotificationSubscription[] = yield* Effect.forEach(
					storedSubscriptions.filter(({ isActive, metadata }) => !isActive || metadata !== null),
					({ metadata, isActive, signalSchemaSlug, signalSchemaPluginId }) =>
						Effect.gen(function* () {
							return {
								metadata,
								isActive,
								signalSchemaSlug,
								signalSchemaPluginKey: signalSchemaPluginId
									? yield* requirePluginKey(pluginKeyById, signalSchemaPluginId)
									: null,
							};
						}),
				);
				const referencedInstallationIds = new Set(
					yield* exportRepository.listReferencedInstallationIds(userId, pluginRecordLimit + 1),
				);
				const installationRecords: ArchiveInstallation[] = yield* Effect.forEach(
					storedInstallations.filter(
						(state) =>
							includeMetadata &&
							(!isDefaultSystemInstallation(state) || referencedInstallationIds.has(state.id)),
					),
					(state) =>
						Effect.gen(function* () {
							const plugin = installedPlugins.find(({ id }) => id === state.pluginId);
							return {
								configuredSecretPaths: [],
								sortOrder: state.sortOrder,
								hiddenIntent: state.isHidden,
								healthReason: state.healthReason,
								isInitialized: state.isInitialized,
								createdAt: state.createdAt.toISOString(),
								updatedAt: state.updatedAt.toISOString(),
								incompatibilityReason: state.incompatibilityReason,
								userSettings: yield* storedJsonObject(state.userSettings),
								packageKey: yield* requirePluginKey(pluginKeyById, state.pluginId),
								lifecycleIntent: installationLifecycleIntent(state.health, state.isHidden),
								config: plugin?.scope === "system" ? {} : yield* storedJsonObject(state.config),
								homeSavedView:
									state.homeSavedView?.kind === "plugin"
										? {
												kind: "plugin" as const,
												slug: state.homeSavedView.slug,
												pluginKey: yield* requirePluginKey(
													pluginKeyById,
													state.homeSavedView.pluginId,
												),
											}
										: state.homeSavedView,
							};
						}),
				);
				const integrationRecords: ArchiveIntegration[] = yield* Effect.forEach(
					storedIntegrations,
					(integration) =>
						Effect.gen(function* () {
							const installation = yield* requireInstallation(
								integration.pluginInstallationId,
								`Backup integration '${integration.id}' references unavailable plugin installation`,
							);
							return {
								id: integration.id,
								lot: integration.lot,
								name: integration.name,
								configuredSecretPaths: [],
								provider: integration.provider,
								isDisabled: integration.isDisabled,
								extraSettings: integration.extraSettings,
								syncOwnership: integration.syncOwnership,
								minimumProgress: integration.minimumProgress,
								maximumProgress: integration.maximumProgress,
								createdAt: integration.createdAt.toISOString(),
								updatedAt: integration.updatedAt.toISOString(),
								lastFinishedAt: integration.lastFinishedAt?.toISOString() ?? null,
								providerSpecifics: yield* storedJsonObject(integration.providerSpecifics),
								packageKey: installation
									? yield* requirePluginKey(pluginKeyById, installation.pluginId)
									: null,
							};
						}),
				);
				const propertyRecords: BackupPropertyRecord[] = [];
				const snapshotDependencyIds = new Set(
					entityDependencies
						.filter((dependency) => dependency.kind === "snapshot")
						.map(({ id }) => id),
				);
				for (const entity of [
					...userEntities,
					...dependencies.filter(({ id }) => snapshotDependencyIds.has(id)),
				]) {
					const propertiesSchema = getEntitySchema(entity)?.propertiesSchema;
					if (propertiesSchema) {
						propertyRecords.push({ propertiesSchema, properties: entity.properties });
					}
				}
				for (const translation of entityDependencies.flatMap((dependency) =>
					dependency.kind === "snapshot"
						? dependency.translations.map((record) => ({ record, dependency }))
						: [],
				)) {
					const stored = dependencies.find((entity) => entity.id === translation.dependency.id);
					const propertiesSchema = stored ? getEntitySchema(stored)?.propertiesSchema : undefined;
					if (propertiesSchema && translation.record.properties) {
						propertyRecords.push({ propertiesSchema, properties: translation.record.properties });
					}
				}
				for (const relationship of relationshipRecords) {
					const stored = storedRelationships.find(({ id }) => id === relationship.id);
					const propertiesSchema = stored
						? context.relationshipSchema(
								relationship.relationshipSchemaSlug,
								stored.relationshipSchemaPluginId,
							)?.propertiesSchema
						: undefined;
					if (propertiesSchema) {
						propertyRecords.push({ propertiesSchema, properties: relationship.properties });
					}
				}
				for (const view of viewRecords) {
					if (view.kind === "custom" && view.renderer.kind === "plugin") {
						const page = context.pluginByKey.get(view.renderer.pluginKey)?.client?.exports?.[
							view.renderer.exportName
						];
						if (page?.kind === "page") {
							propertyRecords.push({
								properties: view.settings,
								propertiesSchema: page.settingsSchema,
							});
						}
					}
				}
				let privatePluginBytes = 0;
				return {
					profile,
					propertyRecords,
					entityDependencies,
					savedViews: viewRecords,
					reminders: reminderRecords,
					foldValues: foldValueRecords,
					integrations: integrationRecords,
					publications: publicationRecords,
					installations: installationRecords,
					relationships: relationshipRecords,
					notificationSubscriptions: subscriptionRecords,
					calendarSourceOverrides: calendarSourceOverrideRecords,
					entities: yield* Effect.forEach(userEntities, (entity) =>
						toArchiveEntity(entity, pluginKeyById),
					),
					hasRecords:
						userEntities.length +
							dependencyRows.length +
							storedRelationships.length +
							storedIntegrations.length +
							storedViews.length +
							storedReminders.length +
							storedPublications.length +
							storedFoldValues.length +
							storedSubscriptions.length +
							storedOverrides.length +
							storedCalendarOverrides.length >
						0,
					nextCursors: {
						views: storedViews.at(-1)?.id ?? cursors.views,
						entities: userEntities.at(-1)?.id ?? cursors.entities,
						reminders: storedReminders.at(-1)?.id ?? cursors.reminders,
						calendar: storedCalendarOverrides.at(-1) ?? cursors.calendar,
						viewOverrides: storedOverrides.at(-1) ?? cursors.viewOverrides,
						dependencies: dependencyRows.at(-1)?.id ?? cursors.dependencies,
						publications: storedPublications.at(-1)?.id ?? cursors.publications,
						foldValues: storedFoldValues.at(-1)?.entityId ?? cursors.foldValues,
						integrations: storedIntegrations.at(-1)?.id ?? cursors.integrations,
						relationships: storedRelationships.at(-1)?.id ?? cursors.relationships,
						subscriptions: storedSubscriptions.at(-1)?.id ?? cursors.subscriptions,
					} satisfies ExportCursors,
					privatePlugins: yield* Effect.forEach(includeMetadata ? privatePlugins : [], (plugin) =>
						Effect.gen(function* () {
							const compiledArtifacts = yield* plugins.listCompiledPackageArtifacts(plugin.id);
							const compiledClient = compiledArtifacts.compiledClient
								? yield* Schema.decodeEffect(PluginClientArtifact)(
										compiledArtifacts.compiledClient,
									).pipe(
										Effect.mapError(() =>
											badRequest("Backup private client artifact package identity is invalid"),
										),
									)
								: undefined;
							if (
								compiledClient &&
								compiledClient.packageId !== plugin.manifest.metadata.packageId
							) {
								return yield* badRequest(
									"Backup private client artifact package identity is invalid",
								);
							}
							const record = {
								manifest: plugin.manifest,
								contentHash: plugin.contentHash,
								version: plugin.manifest.metadata.version,
								packageId: plugin.manifest.metadata.packageId,
								compiledScripts: compiledArtifacts.compiledScripts,
								key: yield* requirePluginKey(pluginKeyById, plugin.id),
								...(compiledClient ? { compiledClient } : {}),
							};
							const encoded = yield* Effect.try({
								try: () =>
									encodeArchiveJsonLine(
										ARCHIVE_CODECS["private-plugins.ndjson"],
										record,
										"private-plugins.ndjson",
									),
								catch: (error) =>
									error instanceof BackupArchiveError
										? error
										: archiveError(
												"invalid_entry",
												"Private plugin encoding failed",
												"private-plugins.ndjson",
											),
							});
							privatePluginBytes += encoded.byteLength;
							if (privatePluginBytes > ARCHIVE_LIMITS.maxMetadataEntryBytes) {
								return yield* archiveEntryTooLarge(
									"private-plugins.ndjson",
									privatePluginBytes,
									ARCHIVE_LIMITS.maxMetadataEntryBytes,
								);
							}
							return record;
						}),
					),
				};
			});

			const readEventPage = Effect.fn("BackupExportSnapshot.readEventPage")(function* (input: {
				userId: UserId;
				afterId?: EventId | undefined;
				pluginKeyById: ReadonlyMap<string, string>;
				excluded: ReadonlyArray<BackupExcludedEventSchema>;
			}) {
				const rows = yield* events.listUserEventsForBackup({
					userId: input.userId,
					limit: exportPageSize,
					afterId: input.afterId,
					excluded: input.excluded,
				});
				const records: ArchiveEvent[] = yield* Effect.forEach(rows, (row) =>
					Effect.gen(function* () {
						return {
							id: row.id,
							entityId: row.entityId,
							orderKey: row.orderKey ?? row.id,
							eventSchemaSlug: row.eventSchemaSlug,
							sessionEntityId: row.sessionEntityId,
							createdAt: row.createdAt.toISOString(),
							updatedAt: row.updatedAt.toISOString(),
							occurredAt: row.occurredAt.toISOString(),
							properties: yield* storedJsonObject(row.properties),
							orderCreatedAt: (row.orderCreatedAt ?? row.createdAt).toISOString(),
							eventSchemaPluginKey: row.eventSchemaPluginId
								? yield* requirePluginKey(input.pluginKeyById, row.eventSchemaPluginId)
								: null,
						} satisfies ArchiveEvent;
					}),
				);
				const lastRecord = records.at(-1);
				return {
					records,
					nextAfterId: lastRecord ? EventId.make(lastRecord.id) : null,
					schemas: new Map(
						rows.map((row) => [
							row.entityId,
							{ slug: row.entitySchemaSlug, pluginId: row.entitySchemaPluginId },
						]),
					),
				};
			});

			const eachEventPage = <E, R>(
				userId: UserId,
				pluginKeyById: ReadonlyMap<string, string>,
				excluded: ReadonlyArray<BackupExcludedEventSchema>,
				handle: (page: BackupEventPage) => Effect.Effect<void, E, R>,
			) =>
				Effect.gen(function* () {
					let afterId: EventId | undefined;
					let hasNextPage = true;
					while (hasNextPage) {
						const page = yield* readEventPage({ userId, afterId, excluded, pluginKeyById });
						yield* handle(page);
						if (page.nextAfterId === null) {
							hasNextPage = false;
						} else {
							afterId = page.nextAfterId;
						}
					}
				});

			const prepareExportPage = Effect.fn("BackupExportSnapshot.prepareExportPage")(function* (
				userId: UserId,
				eventsPath: string,
				runId: BackupRunId,
				cursors: ExportCursors,
				includeMetadata: boolean,
				includeEvents: boolean,
				context: BackupExportContext,
			) {
				const data = yield* readExportData(userId, context, runId, cursors, includeMetadata);
				const { pluginByKey, pluginKeyById, pluginIdForKey } = context;
				const getEntitySchema = (entity: ArchiveUserEntity | ArchiveEntityDependency) =>
					context.entitySchema(
						entity.entitySchemaSlug,
						pluginIdForKey(entity.entitySchemaPluginKey),
					);
				const getSignalSchema = (subscription: ArchiveNotificationSubscription) =>
					context.signalSchema(
						subscription.signalSchemaSlug,
						pluginIdForKey(subscription.signalSchemaPluginKey),
					);
				const eventPropertiesSchema = (event: ArchiveEvent, page: BackupEventPage) => {
					const entitySchema = page.schemas.get(event.entityId);
					return entitySchema
						? definitionForPlugin(
								context.entitySchema(entitySchema.slug, entitySchema.pluginId)?.eventSchemas[
									event.eventSchemaSlug
								],
								pluginIdForKey(event.eventSchemaPluginKey),
							)?.propertiesSchema
						: undefined;
				};
				const additionalPropertyRecords: BackupPropertyRecord[] = [];
				for (const state of data.installations) {
					const plugin = pluginByKey.get(state.packageKey);
					if (!plugin) {
						return yield* badRequest("Backup references unavailable plugin installation");
					}
					if (plugin.userSettingsSchema) {
						additionalPropertyRecords.push({
							properties: state.userSettings,
							propertiesSchema: plugin.userSettingsSchema,
						});
					}
					if (plugin.scope === "system") {
						continue;
					}
					yield* parseAppSchemaProperties({
						kind: "Plugin config",
						properties: state.config,
						propertiesSchema: plugin.configSchema,
						...(state.lifecycleIntent === "needs-configuration" ||
						state.lifecycleIntent === "incompatible"
							? {
									allowedMissingRequiredPaths: concretePluginConfigSecretPaths(
										plugin.configSchema,
										state.config,
									),
								}
							: {}),
					}).pipe(Effect.mapError((error) => badRequest(error.message)));
					additionalPropertyRecords.push({
						properties: state.config,
						propertiesSchema: plugin.configSchema,
					});
				}
				for (const integration of data.integrations) {
					const plugin =
						integration.packageKey === null ? undefined : pluginByKey.get(integration.packageKey);
					const settingsSchema = resolveIntegrationSettingsSchema(
						integration,
						plugin?.integrationProviders,
					);
					if (!settingsSchema) {
						return yield* badRequest("Backup references unavailable integration provider");
					}
					yield* parseAppSchemaProperties({
						kind: "Integration settings",
						propertiesSchema: settingsSchema,
						properties: integration.providerSpecifics,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));
					additionalPropertyRecords.push({
						propertiesSchema: settingsSchema,
						properties: integration.providerSpecifics,
					});
				}
				for (const subscription of data.notificationSubscriptions) {
					const propertiesSchema = yield* requireNotificationMetadataSchema(
						subscription,
						getSignalSchema(subscription)?.propertiesSchema,
					);
					if (propertiesSchema && isArchiveJsonObject(subscription.metadata)) {
						additionalPropertyRecords.push({ propertiesSchema, properties: subscription.metadata });
					}
				}
				const collectedLocators = new Map<string, ManagedAssetLocator>();
				collectManagedAssetLocatorsInto(data.propertyRecords, collectedLocators);
				collectManagedAssetLocatorsInto(additionalPropertyRecords, collectedLocators);
				const requestedLocators = sortedManagedAssetLocators(collectedLocators);
				const managedAssets = yield* uploads.verifyManagedAssetOwnership(userId, requestedLocators);
				const archiveLocators = new Map<string, AssetLocator>(
					managedAssets.map((asset) => [
						managedAssetLocatorKey({ key: asset.key, type: asset.provider }),
						rewriteAssetLocatorForArchive({ key: asset.key, type: asset.provider }, asset.sha256),
					]),
				);
				const redactions: string[] = [];
				let redactionBytes = 0;
				const transformProperties = Effect.fn(function* (
					properties: Record<string, unknown>,
					propertiesSchema: AppSchema,
					path: string,
					locators: ReadonlyMap<string, AssetLocator> = archiveLocators,
				) {
					const redacted = redactSchemaSecrets(
						yield* storedJsonObject(properties),
						propertiesSchema,
						path,
					);
					redactions.push(...redacted.redactions);
					redactionBytes += redacted.redactions.reduce(
						(size, pointer) => size + new TextEncoder().encode(pointer).byteLength + 4,
						0,
					);
					if (redactionBytes > ARCHIVE_LIMITS.maxMetadataEntryBytes) {
						return yield* archiveEntryTooLarge(
							"manifest.json",
							redactionBytes,
							ARCHIVE_LIMITS.maxMetadataEntryBytes,
						);
					}
					return yield* rewriteManagedAssetLocators(
						redacted.redacted,
						propertiesSchema,
						locators,
					).pipe(Effect.mapError(archiveReferenceError));
				});
				const exportedEntities: ArchiveUserEntity[] = [];
				for (const entity of data.entities) {
					const propertiesSchema = getEntitySchema(entity)?.propertiesSchema;
					if (!propertiesSchema) {
						return yield* badRequest(
							`Backup references unavailable entity schema '${entity.entitySchemaSlug}'`,
						);
					}
					exportedEntities.push({
						...entity,
						properties: yield* transformProperties(
							entity.properties,
							propertiesSchema,
							`/entities/${entity.id}/properties`,
						),
					});
				}
				const entityDependencies: ArchiveEntityDependency[] = [];
				for (const dependency of data.entityDependencies) {
					if (dependency.kind !== "snapshot") {
						entityDependencies.push(dependency);
						continue;
					}
					const propertiesSchema = getEntitySchema(dependency)?.propertiesSchema;
					if (!propertiesSchema) {
						return yield* badRequest(
							`Backup references unavailable entity schema '${dependency.entitySchemaSlug}'`,
						);
					}
					const entityTranslations = [];
					for (const [index, translation] of dependency.translations.entries()) {
						entityTranslations.push({
							...translation,
							properties:
								translation.properties === null
									? null
									: yield* transformProperties(
											translation.properties,
											propertiesSchema,
											`/entity-dependencies/${dependency.id}/translations/${index}/properties`,
										),
						});
					}
					entityDependencies.push({
						...dependency,
						translations: entityTranslations,
						properties: yield* transformProperties(
							dependency.properties,
							propertiesSchema,
							`/entity-dependencies/${dependency.id}/properties`,
						),
					});
				}
				const exportedRelationships: ArchiveRelationship[] = [];
				for (const relationship of data.relationships) {
					const propertiesSchema = context.relationshipSchema(
						relationship.relationshipSchemaSlug,
						pluginIdForKey(relationship.relationshipSchemaPluginKey),
					)?.propertiesSchema;
					if (!propertiesSchema) {
						return yield* badRequest(
							`Backup references unavailable relationship schema '${relationship.relationshipSchemaSlug}'`,
						);
					}
					exportedRelationships.push({
						...relationship,
						properties: yield* transformProperties(
							relationship.properties,
							propertiesSchema,
							`/relationships/${relationship.id}/properties`,
						),
					});
				}
				let eventCount = 0;
				const eventsHash = new IncrementalSha256();
				if (includeEvents) {
					yield* fs.writeFile(eventsPath, new Uint8Array(0));
				}
				if (includeEvents) {
					yield* eachEventPage(userId, pluginKeyById, transientEvidenceSchemas(context), (page) =>
						Effect.gen(function* () {
							const pageLocators = new Map<string, ManagedAssetLocator>();
							collectManagedAssetLocatorsInto(
								page.records.flatMap((event) => {
									const propertiesSchema = eventPropertiesSchema(event, page);
									return propertiesSchema
										? [{ propertiesSchema, properties: event.properties }]
										: [];
								}),
								pageLocators,
							);
							const pageAssets = yield* uploads.verifyManagedAssetOwnership(
								userId,
								sortedManagedAssetLocators(pageLocators),
							);
							for (const asset of pageAssets) {
								if (!managedAssets.some((existing) => existing.sha256 === asset.sha256)) {
									managedAssets.push(asset);
									if (managedAssets.length + 13 > ARCHIVE_LIMITS.maxEntryCount) {
										return yield* archiveError(
											"entry_count_exceeded",
											"Backup asset entry limit exceeded",
										);
									}
								}
							}
							const pageArchiveLocators = new Map(
								pageAssets.map((asset) => [
									managedAssetLocatorKey({ key: asset.key, type: asset.provider }),
									rewriteAssetLocatorForArchive(
										{ key: asset.key, type: asset.provider },
										asset.sha256,
									),
								]),
							);
							const eventRecords: ArchiveEvent[] = [];
							for (const event of page.records) {
								const propertiesSchema = eventPropertiesSchema(event, page);
								if (!propertiesSchema) {
									return yield* badRequest(
										`Backup references unavailable event schema '${event.eventSchemaSlug}'`,
									);
								}
								eventRecords.push({
									...event,
									properties: yield* transformProperties(
										event.properties,
										propertiesSchema,
										`/events/${event.id}/properties`,
										pageArchiveLocators,
									),
								});
							}
							const payload = yield* Effect.try({
								try: () =>
									concatEncoded(
										encodeNdjson(eventRecords, ARCHIVE_CODECS["events.ndjson"], "events.ndjson"),
									),
								catch: (error) =>
									error instanceof BackupArchiveError
										? error
										: archiveError("invalid_entry", "Event encoding failed", "events.ndjson"),
							});
							eventCount += eventRecords.length;
							eventsHash.update(payload);
							if (eventsHash.bytes > ARCHIVE_LIMITS.maxEntryBytes) {
								return yield* archiveEntryTooLarge(
									"events.ndjson",
									eventsHash.bytes,
									ARCHIVE_LIMITS.maxEntryBytes,
								);
							}
							return yield* fs.writeFile(eventsPath, payload, { flag: "a" });
						}),
					);
				}
				const exportedInstallations: ArchiveInstallation[] = [];
				for (const state of data.installations) {
					const plugin = pluginByKey.get(state.packageKey);
					if (!plugin) {
						return yield* badRequest("Backup references unavailable plugin installation");
					}
					const userSettings = plugin.userSettingsSchema
						? yield* transformProperties(
								state.userSettings,
								plugin.userSettingsSchema,
								`/installations/${escapePointer(state.packageKey)}/userSettings`,
							)
						: state.userSettings;
					if (plugin.scope === "system") {
						exportedInstallations.push({
							...state,
							config: {},
							userSettings,
							configuredSecretPaths: [],
						});
						continue;
					}
					const configPath = `/installations/${escapePointer(state.packageKey)}/config`;
					const config = yield* transformProperties(state.config, plugin.configSchema, configPath);
					exportedInstallations.push({
						...state,
						config,
						userSettings,
						configuredSecretPaths: redactions
							.filter((path) => path.startsWith(`${configPath}/`))
							.map((path) => path.slice(configPath.length)),
					});
				}
				const restoredIntegrations: ArchiveIntegration[] = [];
				for (const integration of data.integrations) {
					const plugin =
						integration.packageKey === null ? undefined : pluginByKey.get(integration.packageKey);
					const settingsSchema = resolveIntegrationSettingsSchema(
						integration,
						plugin?.integrationProviders,
					);
					if (!settingsSchema) {
						return yield* badRequest("Backup references unavailable integration provider");
					}
					restoredIntegrations.push({
						...integration,
						providerSpecifics: yield* transformProperties(
							integration.providerSpecifics,
							settingsSchema,
							`/integrations/${integration.id}/providerSpecifics`,
						),
						configuredSecretPaths: redactions
							.filter((path) =>
								path.startsWith(`/integrations/${integration.id}/providerSpecifics/`),
							)
							.map((path) =>
								path.slice(`/integrations/${integration.id}/providerSpecifics`.length),
							),
					});
				}
				const notificationSubscriptions: ArchiveNotificationSubscription[] = [];
				for (const subscription of data.notificationSubscriptions) {
					const propertiesSchema = yield* requireNotificationMetadataSchema(
						subscription,
						getSignalSchema(subscription)?.propertiesSchema,
					);
					notificationSubscriptions.push({
						...subscription,
						metadata:
							propertiesSchema && isArchiveJsonObject(subscription.metadata)
								? yield* transformProperties(
										subscription.metadata,
										propertiesSchema,
										`/notification-subscriptions/${subscription.signalSchemaSlug}/metadata`,
									)
								: subscription.metadata,
					});
				}
				const exportedViews: ArchiveSavedView[] = [];
				for (const view of data.savedViews) {
					if (view.kind === "custom" && view.renderer.kind === "plugin") {
						const page = pluginByKey.get(view.renderer.pluginKey)?.client?.exports?.[
							view.renderer.exportName
						];
						exportedViews.push(
							page?.kind === "page"
								? {
										...view,
										settings: yield* transformProperties(
											view.settings,
											page.settingsSchema,
											`/saved-views/${view.id}/settings`,
										),
									}
								: view,
						);
					} else {
						exportedViews.push(view);
					}
				}
				const records = {
					entityDependencies,
					profile: data.profile,
					reminders: data.reminders,
					notificationSubscriptions,
					savedViews: exportedViews,
					entities: exportedEntities,
					foldValues: data.foldValues,
					publications: data.publications,
					integrations: restoredIntegrations,
					privatePlugins: data.privatePlugins,
					relationships: exportedRelationships,
					installations: exportedInstallations,
					calendarSourceOverrides: data.calendarSourceOverrides,
				} satisfies ArchiveRecords;
				const referencedPluginKeys = collectReferencedPluginKeys(records);
				const requiredPlugins = context.installedPlugins
					.filter(
						(plugin) =>
							plugin.scope === "system" && referencedPluginKeys.has(pluginPackageKey(plugin)),
					)
					.map(({ version, manifest, packageId, contentHash }) => ({
						version,
						packageId,
						contentHash,
						definitionContract: archivePluginDefinitionContract(manifest),
					}));
				return {
					records,
					managedAssets,
					requiredPlugins,
					hasRecords: data.hasRecords,
					nextCursors: data.nextCursors,
					redactions: [...new Set(redactions)].sort(),
					events: { path: eventsPath, count: eventCount, ...eventsHash.digest() },
				};
			});

			const prepareExportSnapshot = Effect.fn("BackupExportSnapshot.prepareExportSnapshot")(
				function* (userId: UserId, eventsPath: string, runId: BackupRunId) {
					yield* exportRepository.assertMetadataBounds(
						userId,
						ARCHIVE_LIMITS.maxMetadataEntryBytes,
					);
					const definitions = yield* definitionRepository.getUserSnapshot(userId, { listed: true });
					const context = yield* readExportContext(userId, definitions);
					const declarations: BackupPropertyReferenceDeclaration[] = [];
					const declare = (
						kind: BackupPropertyReferenceDeclaration["kind"],
						slug: string,
						pluginId: null | string,
						propertiesSchema: AppSchema,
						entitySchemaSlug: null | string = null,
						entitySchemaPluginId: null | string = null,
					) => {
						const paths = eventEntityReferencePaths(propertiesSchema);
						if (paths.length > 0) {
							declarations.push({
								kind,
								slug,
								paths,
								pluginId,
								entitySchemaSlug,
								entitySchemaPluginId,
							});
						}
					};
					for (const snapshot of context.definitionSnapshots) {
						for (const entity of Object.values(snapshot.entitySchemas)) {
							declare("entity", entity.slug, entity.pluginId, entity.propertiesSchema);
							for (const event of Object.values(entity.eventSchemas)) {
								declare(
									"event",
									event.slug,
									event.pluginId,
									event.propertiesSchema,
									entity.slug,
									entity.pluginId,
								);
							}
						}
						for (const relationship of Object.values(snapshot.relationshipSchemas)) {
							declare(
								"relationship",
								relationship.slug,
								relationship.pluginId,
								relationship.propertiesSchema,
							);
						}
						for (const signal of Object.values(snapshot.signalSchemas)) {
							declare("signal", signal.slug, signal.pluginId, signal.propertiesSchema);
						}
					}
					for (const plugin of context.installedPlugins) {
						for (const integration of plugin.integrationProviders) {
							declare("integration", integration.slug, plugin.id, integration.settingsSchema);
						}
						if (plugin.userSettingsSchema) {
							declare("user-settings", "", plugin.id, plugin.userSettingsSchema);
						}
						for (const [name, page] of Object.entries(plugin.client?.exports ?? {})) {
							if (page.kind === "page") {
								declare("view-settings", name, plugin.id, page.settingsSchema);
							}
						}
					}
					yield* exportRepository.discoverDependencies(runId, userId, declarations);
					const installationMetadata = yield* installations.listHydratedForUser(
						userId,
						pluginRecordLimit + 1,
					);
					if (installationMetadata.length > pluginRecordLimit) {
						return yield* archiveError(
							"count_mismatch",
							"Installation metadata limit exceeded",
							"installations.ndjson",
						);
					}
					for (const state of installationMetadata) {
						const plugin = context.installedPlugins.find(({ id }) => id === state.pluginId);
						if (!plugin) {
							continue;
						}
						const propertyRecords: BackupPropertyRecord[] = [];
						if (plugin.scope !== "system") {
							propertyRecords.push({
								properties: state.config,
								propertiesSchema: plugin.configSchema,
							});
						}
						if (plugin.userSettingsSchema) {
							propertyRecords.push({
								properties: state.userSettings,
								propertiesSchema: plugin.userSettingsSchema,
							});
						}
						yield* exportRepository.addDependencyIds(
							runId,
							collectEmbeddedEntityIds(propertyRecords),
						);
					}
					while ((yield* exportRepository.discoverSnapshotDependencies(runId, declarations)) > 0) {}
					let totalBytes = 0;
					const spool = <A, I>(path: StreamedSectionPath, codec: Schema.Codec<A, I>) => {
						const hash = new IncrementalSha256();
						const filePath = `${eventsPath}.${path}`;
						let count = 0;
						const append = Effect.fnUntraced(function* (records: ReadonlyArray<A>) {
							for (const record of records) {
								const chunk = yield* Effect.try({
									try: () => encodeArchiveJsonLine(codec, record, path),
									catch: (error) =>
										error instanceof BackupArchiveError
											? error
											: archiveError("invalid_entry", "Record encoding failed", path),
								});
								hash.update(chunk);
								count += 1;
								if (hash.bytes > ARCHIVE_LIMITS.maxEntryBytes) {
									return yield* archiveEntryTooLarge(
										path,
										hash.bytes,
										ARCHIVE_LIMITS.maxEntryBytes,
									);
								}
								totalBytes += chunk.byteLength;
								if (totalBytes > ARCHIVE_LIMITS.maxTotalUncompressedBytes) {
									return yield* archiveError(
										"total_size_exceeded",
										"Backup streamed data limit exceeded",
										path,
									);
								}
								yield* fs.writeFile(filePath, chunk, { flag: "a" });
							}
							return yield* Effect.void;
						});
						return {
							append,
							path: filePath,
							summary: () => ({ path, count, ...hash.digest(), filePath }),
						};
					};
					const spools = {
						entities: spool("entities.ndjson", ARCHIVE_CODECS["entities.ndjson"]),
						reminders: spool("reminders.ndjson", ARCHIVE_CODECS["reminders.ndjson"]),
						foldValues: spool("fold-values.ndjson", ARCHIVE_CODECS["fold-values.ndjson"]),
						savedViews: spool("saved-views.ndjson", ARCHIVE_CODECS["saved-views.ndjson"]),
						integrations: spool("integrations.ndjson", ARCHIVE_CODECS["integrations.ndjson"]),
						publications: spool("publications.ndjson", ARCHIVE_CODECS["publications.ndjson"]),
						relationships: spool("relationships.ndjson", ARCHIVE_CODECS["relationships.ndjson"]),
						entityDependencies: spool(
							"entity-dependencies.ndjson",
							ARCHIVE_CODECS["entity-dependencies.ndjson"],
						),
						calendarSourceOverrides: spool(
							"calendar-source-overrides.ndjson",
							ARCHIVE_CODECS["calendar-source-overrides.ndjson"],
						),
						notificationSubscriptions: spool(
							"notification-subscriptions.ndjson",
							ARCHIVE_CODECS["notification-subscriptions.ndjson"],
						),
					};
					for (const section of Object.values(spools)) {
						yield* fs.writeFile(section.path, new Uint8Array(0));
					}
					let cursors = emptyCursors();
					let first = true;
					let metadata: undefined | ArchiveMetadata;
					const assetsBySha = new Map<
						string,
						Effect.Success<ReturnType<typeof uploads.verifyManagedAssetOwnership>>[number]
					>();
					const requiredByPackage = new Map<
						string,
						Effect.Success<ReturnType<typeof prepareExportPage>>["requiredPlugins"][number]
					>();
					const redactions = new Set<string>();
					let redactionBytes = 0;
					const retainSummary = Effect.fnUntraced(function* (
						page: Effect.Success<ReturnType<typeof prepareExportPage>>,
					) {
						for (const asset of page.managedAssets) {
							const previous = assetsBySha.get(asset.sha256);
							if (
								previous &&
								(previous.size !== asset.size || previous.contentType !== asset.contentType)
							) {
								return yield* badRequest("Backup asset metadata is inconsistent");
							}
							assetsBySha.set(asset.sha256, asset);
							if (assetsBySha.size + ARCHIVE_SECTION_PATHS.length > ARCHIVE_LIMITS.maxEntryCount) {
								return yield* archiveError(
									"entry_count_exceeded",
									"Backup asset entry limit exceeded",
								);
							}
						}
						for (const plugin of page.requiredPlugins) {
							requiredByPackage.set(plugin.packageId, plugin);
						}
						for (const pointer of page.redactions) {
							if (!redactions.has(pointer)) {
								redactions.add(pointer);
								redactionBytes += new TextEncoder().encode(pointer).byteLength + 4;
								if (redactionBytes > ARCHIVE_LIMITS.maxMetadataEntryBytes) {
									return yield* archiveEntryTooLarge(
										"manifest.json",
										redactionBytes,
										ARCHIVE_LIMITS.maxMetadataEntryBytes,
									);
								}
							}
						}
						return yield* Effect.void;
					});
					let hasRecords = true;
					while (hasRecords) {
						const page = yield* prepareExportPage(
							userId,
							eventsPath,
							runId,
							cursors,
							first,
							false,
							context,
						);
						if (first) {
							metadata = {
								profile: page.records.profile,
								installations: page.records.installations,
								privatePlugins: page.records.privatePlugins,
							};
						}
						yield* spools.entities.append(page.records.entities);
						yield* spools.entityDependencies.append(page.records.entityDependencies);
						yield* spools.relationships.append(page.records.relationships);
						yield* spools.savedViews.append(page.records.savedViews);
						yield* spools.integrations.append(page.records.integrations);
						yield* spools.reminders.append(page.records.reminders);
						yield* spools.publications.append(page.records.publications);
						yield* spools.foldValues.append(page.records.foldValues);
						yield* spools.calendarSourceOverrides.append(page.records.calendarSourceOverrides);
						yield* spools.notificationSubscriptions.append(page.records.notificationSubscriptions);
						yield* retainSummary(page);
						cursors = page.nextCursors;
						hasRecords = page.hasRecords;
						first = false;
					}
					const eventPage = yield* prepareExportPage(
						userId,
						eventsPath,
						runId,
						cursors,
						false,
						true,
						context,
					);
					yield* retainSummary(eventPage);
					if (!metadata) {
						return yield* badRequest("Backup metadata is unavailable");
					}
					const sections = Object.values(spools).map((section) => section.summary());
					return {
						records: metadata,
						redactions: [...redactions].sort(),
						managedAssets: [...assetsBySha.values()],
						requiredPlugins: [...requiredByPackage.values()],
						sections: [
							...sections,
							{
								...eventPage.events,
								path: "events.ndjson" as const,
								filePath: eventPage.events.path,
							},
						],
					};
				},
			);

			return { prepareExportSnapshot };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.merge(BackupExportRepository.layer, BackupStaging.layer)),
	);
}
