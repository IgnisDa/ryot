import { badRequest } from "@ryot/contract/errors";
import type { AssetLocator, ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { EntityId, EventId, type UserId } from "@ryot/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot/contract/schema/property-schema";
import { isEqual } from "@ryot/ts-utils/lodash";
import { Context, Effect, FileSystem, Layer } from "effect";

import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import type { DefinitionSnapshot, SavedViewDefinition } from "#modules/definition-registry/service";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";

import {
	collectV2EmbeddedEntityIds,
	collectV2ReferencedPluginKeys,
	redactV2SchemaSecrets,
	rewriteV2AssetLocatorForArchive,
	rewriteV2ManagedAssetLocators,
} from "../archive-v2/references";
import type {
	V2ArchiveRecords,
	V2EntityDependency,
	V2Event,
	V2Installation,
	V2Integration,
	V2NotificationSubscription,
	V2Relationship,
	V2SavedView,
	V2UserEntity,
} from "../archive-v2/schemas";
import { decodeV2JsonObject, isV2JsonObject, V2_CODECS } from "../archive-v2/schemas";
import { encodeNdjson, IncrementalSha256 } from "../archive-v2/streaming";
import { isDefaultSystemInstallation } from "../installation-state";

type BackupPropertyRecord = {
	readonly propertiesSchema: AppSchema;
	readonly properties: Record<string, unknown>;
};

type BackupEventPage = {
	readonly nextAfterId: EventId | null;
	readonly records: ReadonlyArray<V2Event>;
	readonly propertyRecords: ReadonlyArray<BackupPropertyRecord>;
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

const installationLifecycleIntent = (health: string, isDisabled: boolean) => {
	if (health !== "ready") {
		return "needs-configuration" as const;
	}
	return isDisabled ? ("disabled" as const) : ("ready" as const);
};

export const requireV2NotificationMetadataSchema = Effect.fn(function* (
	subscription: V2NotificationSubscription,
	propertiesSchema: AppSchema | undefined,
) {
	if (subscription.metadata !== null && !propertiesSchema) {
		return yield* badRequest(
			`Backup references unavailable signal schema '${subscription.signalSchemaSlug}'`,
		);
	}
	return propertiesSchema;
});

const locatorKey = (locator: { readonly type: "local" | "s3"; readonly key: string }) =>
	`${locator.type}:${locator.key}`;

const collectPropertyAssets = (
	property: AppPropertyDefinition,
	value: unknown,
	assets: ManagedAssetLocator[],
) => {
	if (property.secret === true) {
		return;
	}
	if (property.type === "object") {
		if (property.validation?.asset && isV2JsonObject(value)) {
			if (
				(value["type"] === "local" || value["type"] === "s3") &&
				typeof value["key"] === "string"
			) {
				assets.push({ type: value["type"], key: value["key"] });
			}
			return;
		}
		if (isV2JsonObject(value)) {
			for (const [key, child] of Object.entries(property.properties)) {
				collectPropertyAssets(child, value[key], assets);
			}
		}
		return;
	}
	if (property.type === "array" && Array.isArray(value)) {
		for (const item of value) {
			collectPropertyAssets(property.items, item, assets);
		}
	}
};

const collectManagedAssetLocatorsInto = (
	records: ReadonlyArray<BackupPropertyRecord>,
	collected: Map<string, ManagedAssetLocator>,
) => {
	const assets: ManagedAssetLocator[] = [];
	for (const { properties, propertiesSchema } of records) {
		for (const [key, property] of Object.entries(propertiesSchema.fields)) {
			collectPropertyAssets(property, properties[key], assets);
		}
	}
	for (const asset of assets) {
		collected.set(locatorKey(asset), asset);
	}
};

const sortedManagedAssetLocators = (collected: ReadonlyMap<string, ManagedAssetLocator>) =>
	[...collected.values()].sort((left, right) => locatorKey(left).localeCompare(locatorKey(right)));

export const collectManagedAssetLocators = (
	records: ReadonlyArray<BackupPropertyRecord>,
): ReadonlyArray<ManagedAssetLocator> => {
	const collected = new Map<string, ManagedAssetLocator>();
	collectManagedAssetLocatorsInto(records, collected);
	return sortedManagedAssetLocators(collected);
};

const archivePluginKey = (scope: "system" | "user", slug: string, sourceHash: string) =>
	`${scope}:${slug}:${sourceHash}`;

const toV2Entity = (
	entity: PortableEntityRecord,
	pluginKeyById: ReadonlyMap<string, string>,
	schemaDefinition: { readonly pluginId?: string | null | undefined } | undefined,
): V2UserEntity => ({
	id: entity.id,
	name: entity.name,
	externalId: entity.externalId,
	createdAt: entity.createdAt.toISOString(),
	updatedAt: entity.updatedAt.toISOString(),
	entitySchemaSlug: entity.entitySchemaSlug,
	populatedAt: entity.populatedAt?.toISOString() ?? null,
	properties: decodeV2JsonObject(entity.properties),
	entitySchemaPluginKey: schemaDefinition?.pluginId
		? (pluginKeyById.get(schemaDefinition.pluginId) ?? "")
		: null,
	provider: entity.provider
		? {
				providerSlug: entity.provider.providerSlug,
				pluginKey: pluginKeyById.get(entity.provider.pluginId) ?? "",
			}
		: null,
});

const dependencyIdentity = (
	entity: PortableEntityRecord,
	schemaDefinition: { readonly pluginId?: string | null | undefined } | undefined,
	pluginKeyById: ReadonlyMap<string, string>,
): V2EntityDependency["identity"] => {
	if (entity.provider) {
		return {
			kind: "provider",
			providerSlug: entity.provider.providerSlug,
			pluginKey: pluginKeyById.get(entity.provider.pluginId) ?? "",
		};
	}
	if (entity.externalId && schemaDefinition?.pluginId) {
		return {
			kind: "bootstrap",
			externalId: entity.externalId,
			entitySchemaSlug: entity.entitySchemaSlug,
			pluginKey: pluginKeyById.get(schemaDefinition.pluginId) ?? "",
		};
	}
	return { kind: "unmanaged" };
};

const defaultViewState = (view: SavedViewDefinition | undefined) =>
	view ? { ...view, isBuiltin: true, isDisabled: false } : null;

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
			const runtime = yield* PluginRuntimeResolver;
			const savedViews = yield* SavedViewsRepository;
			const automations = yield* AutomationsRepository;
			const integrations = yield* IntegrationsRepository;
			const translations = yield* TranslationsRepository;
			const relationships = yield* RelationshipsRepository;
			const installations = yield* PluginInstallationRepository;

			const readExportData = Effect.fn("BackupExportSnapshot.readExportData")(function* (
				userId: UserId,
				definitions: DefinitionSnapshot,
			) {
				const getEntitySchema = (slug: string) => definitions.entitySchemas[slug];
				const profile = yield* auth.getPortableProfile(userId);
				if (!profile) {
					return yield* badRequest("Backup user does not exist");
				}
				const allStoredInstallations = yield* installations.listForUser(userId);
				const systemPlugins = yield* plugins.listPortablePluginMetadata();
				const privatePlugins = yield* plugins.listPrivateForUser(userId);
				const installedPlugins = [
					...systemPlugins.map((plugin) => Object.assign({}, plugin, { scope: "system" as const })),
					...privatePlugins.map((plugin) => ({
						id: plugin.id,
						slug: plugin.slug,
						scope: "user" as const,
						metadata: plugin.manifest.metadata,
						version: plugin.manifest.metadata.version,
						configSchema: plugin.manifest.configSchema,
						integrationProviders: plugin.manifest.integrationProviders,
						sourceHash: plugin.sourceHash,
						signalSchemaSlugs: plugin.manifest.signalSchemas.map(({ slug }) => slug),
						relationshipSchemaSlugs: plugin.manifest.relationshipSchemas.map(({ slug }) => slug),
					})),
				];
				const installedPluginIds = new Set(installedPlugins.map(({ id }) => id));
				const storedInstallations = allStoredInstallations.filter(({ pluginId }) =>
					installedPluginIds.has(pluginId),
				);
				const pluginKeyById = new Map(
					installedPlugins.map((plugin) => [
						plugin.id,
						archivePluginKey(plugin.scope, plugin.slug, plugin.sourceHash),
					]),
				);
				const userEntities = yield* entities.listUserEntitiesForBackup(userId);
				const referencedDependencies =
					yield* entities.listReferencedGlobalEntitiesForBackup(userId);
				const embeddedDependencies = yield* entities.listGlobalEntitiesByIdsForBackup(
					collectV2EmbeddedEntityIds(
						userEntities.flatMap((entity) => {
							const propertiesSchema = getEntitySchema(entity.entitySchemaSlug)?.propertiesSchema;
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
				const storedRelationships = yield* relationships.listUserRelationshipsForBackup(userId);
				const storedIntegrations = yield* integrations.listForBackup(userId);
				const storedViews = yield* savedViews.listForBackup(userId);
				const storedSubscriptions =
					yield* automations.listNotificationSubscriptionsForBackup(userId);
				const translationRows = yield* translations.listForBackup(
					dependencies.map(({ id }) => EntityId.make(id)),
				);
				const translationsByEntity = Map.groupBy(translationRows, ({ entityId }) => entityId);
				const entityDependencies: V2EntityDependency[] = dependencies.map((entity) => ({
					...toV2Entity(entity, pluginKeyById, getEntitySchema(entity.entitySchemaSlug)),
					identity: dependencyIdentity(
						entity,
						getEntitySchema(entity.entitySchemaSlug),
						pluginKeyById,
					),
					translations: (translationsByEntity.get(entity.id) ?? []).map((translation) => ({
						id: translation.id,
						name: translation.name,
						language: translation.language,
						createdAt: translation.createdAt.toISOString(),
						updatedAt: translation.updatedAt.toISOString(),
						populatedAt: translation.populatedAt?.toISOString() ?? null,
						properties: translation.properties ? decodeV2JsonObject(translation.properties) : null,
					})),
				}));
				const relationshipRecords: V2Relationship[] = storedRelationships.map((relationship) => {
					const pluginId =
						definitions.relationshipSchemas[relationship.relationshipSchemaSlug]?.pluginId;
					return {
						scope: "user",
						id: relationship.id,
						sourceEntityId: relationship.sourceEntityId,
						targetEntityId: relationship.targetEntityId,
						createdAt: relationship.createdAt.toISOString(),
						relationshipSchemaSlug: relationship.relationshipSchemaSlug,
						properties: decodeV2JsonObject(relationship.properties),
						relationshipSchemaPluginKey: pluginId ? (pluginKeyById.get(pluginId) ?? "") : null,
					};
				});
				const viewRecords = storedViews.flatMap((view): V2SavedView[] => {
					const {
						entitySchemaPluginId: _entitySchemaPluginId,
						pluginInstallationId,
						...portableView
					} = view;
					const viewDefinition = definitions.savedViews[view.slug];
					const entitySchemaDefinition = definitions.entitySchemas[view.entitySchemaSlug ?? ""];
					const installation = storedInstallations.find(
						(state) => state.id === pluginInstallationId,
					);
					const viewPluginId = view.isBuiltin ? viewDefinition?.pluginId : installation?.pluginId;
					const qualified = {
						pluginKey: viewPluginId ? (pluginKeyById.get(viewPluginId) ?? "") : null,
						entitySchemaPluginKey: entitySchemaDefinition?.pluginId
							? (pluginKeyById.get(entitySchemaDefinition.pluginId) ?? "")
							: null,
					};
					if (!view.isBuiltin) {
						return [
							{ ...portableView, ...qualified, kind: "custom" as const, isBuiltin: false as const },
						];
					}
					const expected = defaultViewState(viewDefinition);
					const actual = {
						slug: view.slug,
						name: view.name,
						icon: view.icon,
						layouts: view.layouts,
						isBuiltin: view.isBuiltin,
						sortOrder: view.sortOrder,
						isDisabled: view.isDisabled,
						pluginSlug: view.pluginSlug,
						entitySchemaSlug: view.entitySchemaSlug,
					};
					return expected && isEqual(actual, expected)
						? []
						: [
								{
									...portableView,
									...qualified,
									isBuiltin: true as const,
									kind: "builtin-override" as const,
								},
							];
				});
				const subscriptionRecords: V2NotificationSubscription[] = storedSubscriptions
					.filter(({ isActive, metadata }) => !isActive || metadata !== null)
					.map(({ metadata, isActive, signalSchemaSlug }) => {
						const pluginId = definitions.signalSchemas[signalSchemaSlug]?.pluginId;
						return {
							metadata,
							isActive,
							signalSchemaSlug,
							signalSchemaPluginKey: pluginId ? (pluginKeyById.get(pluginId) ?? "") : null,
						};
					});
				const referencedInstallationIds = new Set([
					...storedIntegrations.map(({ pluginInstallationId }) => pluginInstallationId),
					...storedViews.flatMap(({ pluginInstallationId }) =>
						pluginInstallationId ? [pluginInstallationId] : [],
					),
				]);
				const installationRecords: V2Installation[] = storedInstallations
					.filter(
						(state) =>
							!isDefaultSystemInstallation(state) || referencedInstallationIds.has(state.id),
					)
					.map((state) => {
						const plugin = installedPlugins.find(({ id }) => id === state.pluginId);
						return {
							id: state.id,
							configuredSecretPaths: [],
							sortOrder: state.sortOrder,
							disabledIntent: state.isDisabled,
							createdAt: state.createdAt.toISOString(),
							updatedAt: state.updatedAt.toISOString(),
							packageKey: pluginKeyById.get(state.pluginId) ?? "",
							config: plugin?.scope === "system" ? {} : decodeV2JsonObject(state.config),
							lifecycleIntent: installationLifecycleIntent(state.health, state.isDisabled),
						};
					});
				const installationById = new Map(storedInstallations.map((state) => [state.id, state]));
				const integrationRecords: V2Integration[] = storedIntegrations.map((integration) => ({
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
					providerSpecifics: decodeV2JsonObject(integration.providerSpecifics),
					packageKey:
						pluginKeyById.get(
							installationById.get(integration.pluginInstallationId)?.pluginId ?? "",
						) ?? "",
				}));
				const propertyRecords: BackupPropertyRecord[] = [];
				for (const entity of [...userEntities, ...dependencies]) {
					const propertiesSchema = getEntitySchema(entity.entitySchemaSlug)?.propertiesSchema;
					if (propertiesSchema) {
						propertyRecords.push({ propertiesSchema, properties: entity.properties });
					}
				}
				for (const translation of entityDependencies.flatMap(
					({ entitySchemaSlug, translations: dependencyTranslations }) =>
						dependencyTranslations.map((record) => ({ entitySchemaSlug, record })),
				)) {
					const propertiesSchema = getEntitySchema(translation.entitySchemaSlug)?.propertiesSchema;
					if (propertiesSchema && translation.record.properties) {
						propertyRecords.push({ propertiesSchema, properties: translation.record.properties });
					}
				}
				for (const relationship of relationshipRecords) {
					const propertiesSchema =
						definitions.relationshipSchemas[relationship.relationshipSchemaSlug]?.propertiesSchema;
					if (propertiesSchema) {
						propertyRecords.push({ propertiesSchema, properties: relationship.properties });
					}
				}
				return {
					propertyRecords,
					installedPlugins,
					entityDependencies,
					savedViews: viewRecords,
					integrations: integrationRecords,
					installations: installationRecords,
					relationships: relationshipRecords,
					notificationSubscriptions: subscriptionRecords,
					entities: userEntities.map((entity) =>
						toV2Entity(entity, pluginKeyById, getEntitySchema(entity.entitySchemaSlug)),
					),
					profile: { ...profile, preferences: decodeV2JsonObject(profile.preferences) },
					privatePlugins: privatePlugins.map((plugin) => ({
						key: pluginKeyById.get(plugin.id) ?? "",
						slug: plugin.slug,
						files: plugin.sourceFiles,
						manifest: plugin.manifest,
						sourceHash: plugin.sourceHash,
						version: plugin.manifest.metadata.version,
					})),
				};
			});

			const readEventPage = Effect.fn("BackupExportSnapshot.readEventPage")(function* (input: {
				userId: UserId;
				definitions: DefinitionSnapshot;
				afterId?: EventId | undefined;
			}) {
				const rows = yield* events.listUserEventsForBackup(input);
				const systemPlugins = yield* plugins.listPortablePluginMetadata();
				const privatePlugins = yield* plugins.listPrivateForUser(input.userId);
				const pluginKeyById = new Map([
					...systemPlugins.map(
						(plugin) =>
							[plugin.id, archivePluginKey("system", plugin.slug, plugin.sourceHash)] as const,
					),
					...privatePlugins.map(
						(plugin) =>
							[plugin.id, archivePluginKey("user", plugin.slug, plugin.sourceHash)] as const,
					),
				]);
				const entityIds = [
					...new Set(
						rows.flatMap(({ entityId, sessionEntityId }) =>
							sessionEntityId ? [entityId, sessionEntityId] : [entityId],
						),
					),
				].map((id) => EntityId.make(id));
				const referenced = yield* entities.getByIdsForUser({ userId: input.userId, entityIds });
				const entitySchemaById = new Map(
					referenced.map((entity) => [entity.id, entity.entitySchemaSlug]),
				);
				const records: V2Event[] = rows.map((row) => {
					const entitySchemaSlug = entitySchemaById.get(EntityId.make(row.entityId));
					const pluginId = entitySchemaSlug
						? input.definitions.entitySchemas[entitySchemaSlug]?.eventSchemas[row.eventSchemaSlug]
								?.pluginId
						: null;
					return {
						id: row.id,
						entityId: row.entityId,
						eventSchemaSlug: row.eventSchemaSlug,
						sessionEntityId: row.sessionEntityId,
						createdAt: row.createdAt.toISOString(),
						updatedAt: row.updatedAt.toISOString(),
						occurredAt: row.occurredAt.toISOString(),
						properties: decodeV2JsonObject(row.properties),
						eventSchemaPluginKey: pluginId ? (pluginKeyById.get(pluginId) ?? "") : null,
					};
				});
				const propertyRecords = records.flatMap((record): BackupPropertyRecord[] => {
					const entitySchemaSlug = entitySchemaById.get(EntityId.make(record.entityId));
					const propertiesSchema = entitySchemaSlug
						? input.definitions.entitySchemas[entitySchemaSlug]?.eventSchemas[
								record.eventSchemaSlug
							]?.propertiesSchema
						: undefined;
					return propertiesSchema ? [{ propertiesSchema, properties: record.properties }] : [];
				});
				const lastRecord = records.at(-1);
				return {
					records,
					propertyRecords,
					nextAfterId: lastRecord ? EventId.make(lastRecord.id) : null,
				};
			});

			const eachEventPage = <E, R>(
				userId: UserId,
				definitions: DefinitionSnapshot,
				handle: (page: BackupEventPage) => Effect.Effect<void, E, R>,
			) =>
				Effect.gen(function* () {
					let afterId: EventId | undefined;
					let hasNextPage = true;
					while (hasNextPage) {
						const page = yield* readEventPage({ userId, definitions, afterId });
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
					const definitions = yield* runtime.getEffectiveDefinitions(userId, true);
					const getEntitySchema = (slug: string) => definitions.entitySchemas[slug];
					const data = yield* readExportData(userId, definitions);
					const pluginByKey = new Map(
						data.installedPlugins.map((plugin) => [
							archivePluginKey(plugin.scope, plugin.slug, plugin.sourceHash),
							plugin,
						]),
					);
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
						}).pipe(Effect.mapError((error) => badRequest(error.message)));
						additionalPropertyRecords.push({
							properties: state.config,
							propertiesSchema: plugin.configSchema,
						});
					}
					for (const integration of data.integrations) {
						const plugin = pluginByKey.get(integration.packageKey);
						const provider = plugin?.integrationProviders.find(
							(definition) =>
								definition.slug === integration.provider && definition.lot === integration.lot,
						);
						if (!provider) {
							return yield* badRequest("Backup references unavailable integration provider");
						}
						yield* parseAppSchemaProperties({
							kind: "Integration settings",
							properties: integration.providerSpecifics,
							propertiesSchema: provider.settingsSchema,
						}).pipe(Effect.mapError((error) => badRequest(error.message)));
						additionalPropertyRecords.push({
							properties: integration.providerSpecifics,
							propertiesSchema: provider.settingsSchema,
						});
					}
					for (const subscription of data.notificationSubscriptions) {
						const propertiesSchema = yield* requireV2NotificationMetadataSchema(
							subscription,
							definitions.signalSchemas[subscription.signalSchemaSlug]?.propertiesSchema,
						);
						if (propertiesSchema && isV2JsonObject(subscription.metadata)) {
							additionalPropertyRecords.push({
								propertiesSchema,
								properties: subscription.metadata,
							});
						}
					}
					const collectedLocators = new Map<string, ManagedAssetLocator>();
					collectManagedAssetLocatorsInto(data.propertyRecords, collectedLocators);
					collectManagedAssetLocatorsInto(additionalPropertyRecords, collectedLocators);
					yield* eachEventPage(userId, definitions, (page) =>
						Effect.sync(() =>
							collectManagedAssetLocatorsInto(page.propertyRecords, collectedLocators),
						),
					);
					const requestedLocators = sortedManagedAssetLocators(collectedLocators);
					const managedAssets = yield* uploads.verifyManagedAssetOwnership(
						userId,
						requestedLocators,
					);
					const archiveLocators = new Map<string, AssetLocator>(
						managedAssets.map((asset) => [
							locatorKey({ type: asset.provider, key: asset.key }),
							rewriteV2AssetLocatorForArchive(
								{ type: asset.provider, key: asset.key },
								asset.sha256,
							),
						]),
					);
					const redactions: string[] = [];
					const transformProperties = Effect.fn(function* (
						properties: Record<string, unknown>,
						propertiesSchema: AppSchema,
						path: string,
					) {
						const redacted = redactV2SchemaSecrets(
							decodeV2JsonObject(properties),
							propertiesSchema,
							path,
						);
						redactions.push(...redacted.redactions);
						return yield* rewriteV2ManagedAssetLocators(
							redacted.redacted,
							propertiesSchema,
							archiveLocators,
						);
					});
					const exportedEntities: V2UserEntity[] = [];
					for (const entity of data.entities) {
						const propertiesSchema = getEntitySchema(entity.entitySchemaSlug)?.propertiesSchema;
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
					const entityDependencies: V2EntityDependency[] = [];
					for (const dependency of data.entityDependencies) {
						const propertiesSchema = getEntitySchema(dependency.entitySchemaSlug)?.propertiesSchema;
						if (!propertiesSchema) {
							return yield* badRequest(
								`Backup references unavailable entity schema '${dependency.entitySchemaSlug}'`,
							);
						}
						const entityTranslations = [];
						for (const translation of dependency.translations) {
							entityTranslations.push({
								...translation,
								properties:
									translation.properties === null
										? null
										: yield* transformProperties(
												translation.properties,
												propertiesSchema,
												`/entity-dependencies/${dependency.id}/translations/${translation.id}/properties`,
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
					const exportedRelationships: V2Relationship[] = [];
					for (const relationship of data.relationships) {
						const propertiesSchema =
							definitions.relationshipSchemas[relationship.relationshipSchemaSlug]
								?.propertiesSchema;
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
					const entitySchemaById = new Map(
						[...exportedEntities, ...entityDependencies].map(({ id, entitySchemaSlug }) => [
							id,
							entitySchemaSlug,
						]),
					);
					let eventCount = 0;
					const eventsHash = new IncrementalSha256();
					yield* fs.writeFile(eventsPath, new Uint8Array(0));
					yield* eachEventPage(userId, definitions, (page) =>
						Effect.gen(function* () {
							const eventRecords: V2Event[] = [];
							for (const event of page.records) {
								const entitySchemaSlug = entitySchemaById.get(event.entityId);
								const propertiesSchema = entitySchemaSlug
									? getEntitySchema(entitySchemaSlug)?.eventSchemas[event.eventSchemaSlug]
											?.propertiesSchema
									: undefined;
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
							const payload = concatEncoded(encodeNdjson(eventRecords, V2_CODECS["events.ndjson"]));
							eventCount += eventRecords.length;
							eventsHash.update(payload);
							return yield* fs.writeFile(eventsPath, payload, { flag: "a" });
						}),
					);
					const exportedInstallations: V2Installation[] = [];
					for (const state of data.installations) {
						const plugin = pluginByKey.get(state.packageKey);
						if (!plugin) {
							return yield* badRequest("Backup references unavailable plugin installation");
						}
						if (plugin.scope === "system") {
							exportedInstallations.push({ ...state, config: {}, configuredSecretPaths: [] });
							continue;
						}
						const configPath = `/installations/${state.id}/config`;
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
					const restoredIntegrations: V2Integration[] = [];
					for (const integration of data.integrations) {
						const plugin = pluginByKey.get(integration.packageKey);
						const provider = plugin?.integrationProviders.find(
							(definition) =>
								definition.slug === integration.provider && definition.lot === integration.lot,
						);
						if (!provider) {
							return yield* badRequest("Backup references unavailable integration provider");
						}
						restoredIntegrations.push({
							...integration,
							providerSpecifics: yield* transformProperties(
								integration.providerSpecifics,
								provider.settingsSchema,
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
					const notificationSubscriptions: V2NotificationSubscription[] = [];
					for (const subscription of data.notificationSubscriptions) {
						const propertiesSchema = yield* requireV2NotificationMetadataSchema(
							subscription,
							definitions.signalSchemas[subscription.signalSchemaSlug]?.propertiesSchema,
						);
						notificationSubscriptions.push({
							...subscription,
							metadata:
								propertiesSchema && isV2JsonObject(subscription.metadata)
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
					} satisfies V2ArchiveRecords;
					const referencedPluginKeys = collectV2ReferencedPluginKeys(records);
					const requiredPlugins = data.installedPlugins
						.filter(
							(plugin) =>
								plugin.scope === "system" &&
								referencedPluginKeys.has(
									archivePluginKey(plugin.scope, plugin.slug, plugin.sourceHash),
								),
						)
						.map(({ slug, sourceHash, version }) => ({ slug, sourceHash, version }));
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
	static readonly layer = Layer.effect(this, this.make);
}
