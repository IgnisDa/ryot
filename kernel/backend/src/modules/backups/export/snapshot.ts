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
import { EntityId, EventId, type UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
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
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { resolveIntegrationSettingsSchema } from "#modules/integrations/settings-schema";
import { concretePluginConfigSecretPaths } from "#modules/plugins/configuration/redaction";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { archiveError } from "../archive/error";
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
	ArchiveRecords,
	ArchiveRelationship,
	ArchiveSavedView,
	ArchiveUserEntity,
} from "../archive/schemas";
import {
	ARCHIVE_CODECS,
	archivePluginDefinitionContract,
	decodeArchiveJsonObject,
	isArchiveJsonObject,
} from "../archive/schemas";
import { encodeNdjson, IncrementalSha256 } from "../archive/streaming";
import { isDefaultSystemInstallation } from "../installation-state";
import { BackupExportRepository } from "./repository";

type BackupPropertyRecord = {
	readonly propertiesSchema: AppSchema;
	readonly properties: Record<string, unknown>;
};

const archiveReferenceError = (error: DataReferenceError) =>
	archiveError(error.code, error.message);

type BackupEventPage = {
	readonly nextAfterId: EventId | null;
	readonly records: ReadonlyArray<ArchiveEvent>;
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
	Definition extends { readonly pluginId?: string | null | undefined },
>(
	definition: Definition | undefined,
	pluginId: string | null | undefined,
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
	<Definition extends { readonly pluginId?: string | null | undefined }>(
		kind: string,
		current: Readonly<Record<string, Definition>>,
		historical: (pluginId: string) => Readonly<Record<string, Definition>> | undefined,
	) =>
	(slug: string, pluginId: string | null | undefined) =>
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
		properties: decodeArchiveJsonObject(entity.properties),
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

export class BackupExportSnapshot extends Context.Service<BackupExportSnapshot>()(
	"BackupExportSnapshot",
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
			const translations = yield* TranslationsRepository;
			const relationships = yield* RelationshipsRepository;
			const installations = yield* PluginInstallationRepository;
			const exportRepository = yield* BackupExportRepository;

			const readExportContext = Effect.fn("BackupExportSnapshot.readExportContext")(function* (
				userId: UserId,
				definitions: DefinitionSnapshot,
			) {
				const systemPlugins = yield* plugins.listActiveSystemPlugins();
				const privatePlugins = yield* plugins.listPrivateForUser(userId);
				const installedPlugins = [...systemPlugins, ...privatePlugins].map((plugin) => ({
					id: plugin.id,
					scope: plugin.scope,
					manifest: plugin.manifest,
					contentHash: plugin.contentHash,
					metadata: plugin.manifest.metadata,
					version: plugin.manifest.metadata.version,
					configSchema: plugin.manifest.configSchema,
					packageId: plugin.manifest.metadata.packageId,
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
					pluginIdForKey: (pluginKey: string | null) =>
						pluginKey ? pluginByKey.get(pluginKey)?.id : null,
					...definitionLookups(definitions, privateDefinitionSnapshots(privatePlugins)),
				};
			});

			type BackupExportContext = Effect.Success<ReturnType<typeof readExportContext>>;

			const readExportData = Effect.fn("BackupExportSnapshot.readExportData")(function* (
				userId: UserId,
				context: BackupExportContext,
			) {
				const profile = yield* auth.getPortableProfile(userId);
				if (!profile) {
					return yield* badRequest("Backup user does not exist");
				}
				const allStoredInstallations = yield* installations.listHydratedForUser(userId);
				const { pluginKeyById, privatePlugins, installedPlugins } = context;
				const getEntitySchema = (entity: PortableEntityRecord) =>
					context.entitySchema(entity.entitySchemaSlug, entity.entitySchemaPluginId);
				const installedPluginIds = new Set(installedPlugins.map(({ id }) => id));
				const storedInstallations = allStoredInstallations.filter(({ pluginId }) =>
					installedPluginIds.has(pluginId),
				);
				const userEntities = yield* entities.listUserEntitiesForBackup(userId);
				const referencedDependencies =
					yield* entities.listReferencedGlobalEntitiesForBackup(userId);
				const embeddedDependencies = yield* entities.listGlobalEntitiesByIdsForBackup(
					collectEmbeddedEntityIds(
						userEntities.flatMap((entity) => {
							const propertiesSchema = getEntitySchema(entity)?.propertiesSchema;
							return propertiesSchema ? [{ propertiesSchema, properties: entity.properties }] : [];
						}),
					).map((id) => EntityId.make(id)),
				);
				const dependencies = [
					...new Map(
						[...referencedDependencies, ...embeddedDependencies].map((entity) => [
							entity.id,
							entity,
						]),
					).values(),
				].sort((left, right) => left.id.localeCompare(right.id));
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
				const storedRelationships = yield* relationships.listUserRelationshipsForBackup(userId);
				const storedIntegrations = yield* integrations.listForBackup(userId);
				const storedViews = yield* savedViews.listForBackup(userId);
				const storedSubscriptions =
					yield* automations.listNotificationSubscriptionsForBackup(userId);
				const translationRows = yield* translations.listForBackup(
					dependencies.map(({ id }) => EntityId.make(id)),
				);
				const translationsByEntity = Map.groupBy(translationRows, ({ entityId }) => entityId);
				const entityDependencies: ArchiveEntityDependency[] = yield* Effect.forEach(
					dependencies,
					(entity) =>
						Effect.gen(function* () {
							return {
								...(yield* toArchiveEntity(entity, pluginKeyById)),
								identity: yield* dependencyIdentity(entity, pluginKeyById),
								translations: (translationsByEntity.get(entity.id) ?? []).map((translation) => ({
									name: translation.name,
									language: translation.language,
									createdAt: translation.createdAt.toISOString(),
									updatedAt: translation.updatedAt.toISOString(),
									populatedAt: translation.populatedAt?.toISOString() ?? null,
									properties: translation.properties
										? decodeArchiveJsonObject(translation.properties)
										: null,
								})),
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
								properties: decodeArchiveJsonObject(relationship.properties),
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
				const storedBuiltinViewKeys = new Set(
					storedViews.flatMap((view) =>
						view.isBuiltin
							? [
									definitionKey(
										"saved-view",
										definitionOwner(
											view.reference.kind === "plugin" ? view.reference.pluginId : null,
										),
										view.slug,
									),
								]
							: [],
					),
				);
				const viewRecords: ArchiveSavedView[] = (yield* Effect.forEach(storedViews, (view) =>
					Effect.gen(function* () {
						const installation = allStoredInstallations.find(
							(state) => state.id === view.pluginInstallationId,
						);
						if (view.pluginInstallationId !== null && !installation) {
							return yield* badRequest(
								"Backup saved view references unavailable plugin installation",
							);
						}
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
				for (const override of yield* exportRepository.listSavedViewOverrides(userId)) {
					const key = definitionKey(
						"saved-view",
						definitionOwner(override.pluginId),
						override.slug,
					);
					if (storedBuiltinViewKeys.has(key)) {
						continue;
					}
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
				for (const override of yield* exportRepository.listCalendarSourceOverrides(userId)) {
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
				const referencedInstallationIds = new Set([
					...storedIntegrations.map(({ pluginInstallationId }) => pluginInstallationId),
					...storedViews.flatMap(({ pluginInstallationId }) =>
						pluginInstallationId ? [pluginInstallationId] : [],
					),
					...allStoredInstallations.flatMap(({ id, homeSavedView }) =>
						homeSavedView === null ? [] : [id],
					),
				]);
				const installationRecords: ArchiveInstallation[] = yield* Effect.forEach(
					storedInstallations.filter(
						(state) =>
							!isDefaultSystemInstallation(state) || referencedInstallationIds.has(state.id),
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
								userSettings: decodeArchiveJsonObject(state.userSettings),
								packageKey: yield* requirePluginKey(pluginKeyById, state.pluginId),
								lifecycleIntent: installationLifecycleIntent(state.health, state.isHidden),
								config: plugin?.scope === "system" ? {} : decodeArchiveJsonObject(state.config),
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
				const installationById = new Map(storedInstallations.map((state) => [state.id, state]));
				const integrationRecords: ArchiveIntegration[] = yield* Effect.forEach(
					storedIntegrations,
					(integration) =>
						Effect.gen(function* () {
							const installation =
								integration.pluginInstallationId === null
									? null
									: installationById.get(integration.pluginInstallationId);
							if (integration.pluginInstallationId !== null && !installation) {
								return yield* badRequest(
									`Backup integration '${integration.id}' references unavailable plugin installation`,
								);
							}
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
								providerSpecifics: decodeArchiveJsonObject(integration.providerSpecifics),
								packageKey: installation
									? yield* requirePluginKey(pluginKeyById, installation.pluginId)
									: null,
							};
						}),
				);
				const propertyRecords: BackupPropertyRecord[] = [];
				for (const entity of [...userEntities, ...dependencies]) {
					const propertiesSchema = getEntitySchema(entity)?.propertiesSchema;
					if (propertiesSchema) {
						propertyRecords.push({ propertiesSchema, properties: entity.properties });
					}
				}
				for (const translation of entityDependencies.flatMap((dependency) =>
					dependency.translations.map((record) => ({ record, dependency })),
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
				return {
					profile,
					propertyRecords,
					entityDependencies,
					savedViews: viewRecords,
					integrations: integrationRecords,
					installations: installationRecords,
					relationships: relationshipRecords,
					notificationSubscriptions: subscriptionRecords,
					calendarSourceOverrides: calendarSourceOverrideRecords,
					entities: yield* Effect.forEach(userEntities, (entity) =>
						toArchiveEntity(entity, pluginKeyById),
					),
					privatePlugins: yield* Effect.forEach(privatePlugins, (plugin) =>
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
							return {
								manifest: plugin.manifest,
								contentHash: plugin.contentHash,
								version: plugin.manifest.metadata.version,
								packageId: plugin.manifest.metadata.packageId,
								compiledScripts: compiledArtifacts.compiledScripts,
								key: yield* requirePluginKey(pluginKeyById, plugin.id),
								...(compiledClient ? { compiledClient } : {}),
							};
						}),
					),
				};
			});

			const readEventPage = Effect.fn("BackupExportSnapshot.readEventPage")(function* (input: {
				userId: UserId;
				afterId?: EventId | undefined;
				pluginKeyById: ReadonlyMap<string, string>;
			}) {
				const rows = yield* events.listUserEventsForBackup({
					userId: input.userId,
					afterId: input.afterId,
				});
				const records: ArchiveEvent[] = yield* Effect.forEach(rows, (row) =>
					Effect.gen(function* () {
						return {
							id: row.id,
							entityId: row.entityId,
							eventSchemaSlug: row.eventSchemaSlug,
							sessionEntityId: row.sessionEntityId,
							createdAt: row.createdAt.toISOString(),
							updatedAt: row.updatedAt.toISOString(),
							occurredAt: row.occurredAt.toISOString(),
							properties: decodeArchiveJsonObject(row.properties),
							eventSchemaPluginKey: row.eventSchemaPluginId
								? yield* requirePluginKey(input.pluginKeyById, row.eventSchemaPluginId)
								: null,
						} satisfies ArchiveEvent;
					}),
				);
				const lastRecord = records.at(-1);
				return { records, nextAfterId: lastRecord ? EventId.make(lastRecord.id) : null };
			});

			const eachEventPage = <E, R>(
				userId: UserId,
				pluginKeyById: ReadonlyMap<string, string>,
				handle: (page: BackupEventPage) => Effect.Effect<void, E, R>,
			) =>
				Effect.gen(function* () {
					let afterId: EventId | undefined;
					let hasNextPage = true;
					while (hasNextPage) {
						const page = yield* readEventPage({ userId, afterId, pluginKeyById });
						yield* handle(page);
						if (page.nextAfterId === null) {
							hasNextPage = false;
						} else {
							afterId = page.nextAfterId;
						}
					}
				});

			const prepareExportSnapshot = Effect.fn("BackupExportSnapshot.prepareExportSnapshot")(
				function* (userId: UserId, eventsPath: string) {
					const definitions = yield* definitionRepository.getUserSnapshot(userId, { listed: true });
					const context = yield* readExportContext(userId, definitions);
					const data = yield* readExportData(userId, context);
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
					const entitySchemaByEntityId = new Map(
						[...data.entities, ...data.entityDependencies].map((entity) => [
							entity.id,
							getEntitySchema(entity),
						]),
					);
					const eventPropertiesSchema = (event: ArchiveEvent) =>
						definitionForPlugin(
							entitySchemaByEntityId.get(event.entityId)?.eventSchemas[event.eventSchemaSlug],
							pluginIdForKey(event.eventSchemaPluginKey),
						)?.propertiesSchema;
					const additionalPropertyRecords: BackupPropertyRecord[] = [];
					for (const state of data.installations) {
						const plugin = pluginByKey.get(state.packageKey);
						if (!plugin) {
							return yield* badRequest("Backup references unavailable plugin installation");
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
							additionalPropertyRecords.push({
								propertiesSchema,
								properties: subscription.metadata,
							});
						}
					}
					const collectedLocators = new Map<string, ManagedAssetLocator>();
					collectManagedAssetLocatorsInto(data.propertyRecords, collectedLocators);
					collectManagedAssetLocatorsInto(additionalPropertyRecords, collectedLocators);
					yield* eachEventPage(userId, pluginKeyById, (page) =>
						Effect.sync(() =>
							collectManagedAssetLocatorsInto(
								page.records.flatMap((event) => {
									const propertiesSchema = eventPropertiesSchema(event);
									return propertiesSchema
										? [{ propertiesSchema, properties: event.properties }]
										: [];
								}),
								collectedLocators,
							),
						),
					);
					const requestedLocators = sortedManagedAssetLocators(collectedLocators);
					const managedAssets = yield* uploads.verifyManagedAssetOwnership(
						userId,
						requestedLocators,
					);
					const archiveLocators = new Map<string, AssetLocator>(
						managedAssets.map((asset) => [
							managedAssetLocatorKey({ key: asset.key, type: asset.provider }),
							rewriteAssetLocatorForArchive({ key: asset.key, type: asset.provider }, asset.sha256),
						]),
					);
					const redactions: string[] = [];
					const transformProperties = Effect.fn(function* (
						properties: Record<string, unknown>,
						propertiesSchema: AppSchema,
						path: string,
					) {
						const redacted = redactSchemaSecrets(
							decodeArchiveJsonObject(properties),
							propertiesSchema,
							path,
						);
						redactions.push(...redacted.redactions);
						return yield* rewriteManagedAssetLocators(
							redacted.redacted,
							propertiesSchema,
							archiveLocators,
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
					yield* fs.writeFile(eventsPath, new Uint8Array(0));
					yield* eachEventPage(userId, pluginKeyById, (page) =>
						Effect.gen(function* () {
							const eventRecords: ArchiveEvent[] = [];
							for (const event of page.records) {
								const propertiesSchema = eventPropertiesSchema(event);
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
									),
								});
							}
							const payload = concatEncoded(
								encodeNdjson(eventRecords, ARCHIVE_CODECS["events.ndjson"]),
							);
							eventCount += eventRecords.length;
							eventsHash.update(payload);
							return yield* fs.writeFile(eventsPath, payload, { flag: "a" });
						}),
					);
					const exportedInstallations: ArchiveInstallation[] = [];
					for (const state of data.installations) {
						const plugin = pluginByKey.get(state.packageKey);
						if (!plugin) {
							return yield* badRequest("Backup references unavailable plugin installation");
						}
						if (plugin.scope === "system") {
							exportedInstallations.push({ ...state, config: {}, configuredSecretPaths: [] });
							continue;
						}
						const configPath = `/installations/${escapePointer(state.packageKey)}/config`;
						const config = yield* transformProperties(
							state.config,
							plugin.configSchema,
							configPath,
						);
						exportedInstallations.push({
							...state,
							config,
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
					const records = {
						entityDependencies,
						profile: data.profile,
						notificationSubscriptions,
						entities: exportedEntities,
						savedViews: data.savedViews,
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
						redactions: [...new Set(redactions)].sort(),
						events: { path: eventsPath, count: eventCount, ...eventsHash.digest() },
					};
				},
			);

			return { prepareExportSnapshot };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(BackupExportRepository.layer),
	);
}
