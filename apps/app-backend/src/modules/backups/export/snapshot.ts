import { badRequest } from "@ryot/contract/errors";
import type { AssetLocator, ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { EntityId, EventId, type UserId } from "@ryot/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot/contract/schema/property-schema";
import { isEqual } from "@ryot/ts-utils/lodash";
import { Context, Effect, Layer } from "effect";

import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import { DefinitionRegistry, type SavedViewDefinition } from "#modules/definition-registry/service";
import { DefinitionsRepository } from "#modules/definitions/repository";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository } from "#modules/events/repository";
import { PluginRepository } from "#modules/plugins/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";

import {
	collectV1EmbeddedEntityIds,
	redactV1SchemaSecrets,
	rewriteV1AssetLocatorForArchive,
	rewriteV1ManagedAssetLocators,
} from "../archive-v1/references";
import type {
	V1ArchiveRecords,
	V1EntityDependency,
	V1Event,
	V1NotificationSubscription,
	V1PluginState,
	V1Relationship,
	V1SavedView,
	V1UserEntity,
} from "../archive-v1/schemas";
import { decodeV1JsonObject, isV1JsonObject } from "../archive-v1/schemas";

type BackupPropertyRecord = {
	readonly propertiesSchema: AppSchema;
	readonly properties: Record<string, unknown>;
};

export const requireV1NotificationMetadataSchema = Effect.fn(function* (
	subscription: V1NotificationSubscription,
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
		if (property.validation?.asset && isV1JsonObject(value)) {
			if (
				(value["type"] === "local" || value["type"] === "s3") &&
				typeof value["key"] === "string"
			) {
				assets.push({ type: value["type"], key: value["key"] });
			}
			return;
		}
		if (isV1JsonObject(value)) {
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

export const collectManagedAssetLocators = (
	records: ReadonlyArray<BackupPropertyRecord>,
): ReadonlyArray<ManagedAssetLocator> => {
	const assets: ManagedAssetLocator[] = [];
	for (const { properties, propertiesSchema } of records) {
		for (const [key, property] of Object.entries(propertiesSchema.fields)) {
			collectPropertyAssets(property, properties[key], assets);
		}
	}
	return [...new Map(assets.map((asset) => [`${asset.type}:${asset.key}`, asset])).values()].sort(
		(left, right) => `${left.type}:${left.key}`.localeCompare(`${right.type}:${right.key}`),
	);
};

const toV1Entity = (entity: PortableEntityRecord): V1UserEntity => ({
	id: entity.id,
	name: entity.name,
	provider: entity.provider,
	externalId: entity.externalId,
	createdAt: entity.createdAt.toISOString(),
	updatedAt: entity.updatedAt.toISOString(),
	entitySchemaSlug: entity.entitySchemaSlug,
	properties: decodeV1JsonObject(entity.properties),
	populatedAt: entity.populatedAt?.toISOString() ?? null,
});

const dependencyIdentity = (
	entity: PortableEntityRecord,
	schemaDefinition: { readonly pluginSlug: string | null } | undefined,
): V1EntityDependency["identity"] => {
	if (entity.provider) {
		return {
			kind: "provider",
			pluginSlug: entity.provider.pluginSlug,
			providerSlug: entity.provider.providerSlug,
		};
	}
	if (entity.externalId && schemaDefinition?.pluginSlug) {
		return {
			kind: "bootstrap",
			externalId: entity.externalId,
			pluginSlug: schemaDefinition.pluginSlug,
			entitySchemaSlug: entity.entitySchemaSlug,
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
			const uploads = yield* ManagedAssetsService;
			const plugins = yield* PluginRepository;
			const entities = yield* EntitiesRepository;
			const definitions = yield* DefinitionRegistry;
			const savedViews = yield* SavedViewsRepository;
			const automations = yield* AutomationsRepository;
			const pluginState = yield* DefinitionsRepository;
			const translations = yield* TranslationsRepository;
			const relationships = yield* RelationshipsRepository;

			const readExportData = Effect.fn("BackupExportSnapshot.readExportData")(function* (
				userId: UserId,
			) {
				const profile = yield* auth.getPortableProfile(userId);
				if (!profile) {
					return yield* badRequest("Backup user does not exist");
				}
				const storedPluginState = yield* pluginState.listPluginStates(userId);
				const installedPlugins = yield* plugins.listPortablePluginMetadata();
				const userEntities = yield* entities.listUserEntitiesForBackup(userId);
				const referencedDependencies =
					yield* entities.listReferencedGlobalEntitiesForBackup(userId);
				const embeddedDependencies = yield* entities.listGlobalEntitiesByIdsForBackup(
					collectV1EmbeddedEntityIds(
						userEntities.flatMap((entity) => {
							const propertiesSchema = definitions.getEntitySchema(
								entity.entitySchemaSlug,
							)?.propertiesSchema;
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
				const storedViews = yield* savedViews.listForBackup(userId);
				const storedSubscriptions =
					yield* automations.listNotificationSubscriptionsForBackup(userId);
				const translationRows = yield* translations.listForBackup(
					dependencies.map(({ id }) => EntityId.make(id)),
				);
				const translationsByEntity = Map.groupBy(translationRows, ({ entityId }) => entityId);
				const entityDependencies: V1EntityDependency[] = dependencies.map((entity) => ({
					...toV1Entity(entity),
					identity: dependencyIdentity(
						entity,
						definitions.getEntitySchema(entity.entitySchemaSlug),
					),
					translations: (translationsByEntity.get(entity.id) ?? []).map((translation) => ({
						id: translation.id,
						name: translation.name,
						language: translation.language,
						createdAt: translation.createdAt.toISOString(),
						updatedAt: translation.updatedAt.toISOString(),
						populatedAt: translation.populatedAt?.toISOString() ?? null,
						properties: translation.properties ? decodeV1JsonObject(translation.properties) : null,
					})),
				}));
				const relationshipRecords: V1Relationship[] = storedRelationships.map((relationship) => ({
					scope: "user",
					id: relationship.id,
					sourceEntityId: relationship.sourceEntityId,
					targetEntityId: relationship.targetEntityId,
					createdAt: relationship.createdAt.toISOString(),
					properties: decodeV1JsonObject(relationship.properties),
					relationshipSchemaSlug: relationship.relationshipSchemaSlug,
				}));
				const viewRecords = storedViews.flatMap((view): V1SavedView[] => {
					if (!view.isBuiltin) {
						return [{ ...view, kind: "custom" as const, isBuiltin: false as const }];
					}
					const expected = defaultViewState(definitions.getSavedView(view.slug));
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
						: [{ ...view, kind: "builtin-override" as const, isBuiltin: true as const }];
				});
				const subscriptionRecords: V1NotificationSubscription[] = storedSubscriptions
					.filter(({ isActive, metadata }) => !isActive || metadata !== null)
					.map(({ metadata, isActive, signalSchemaSlug }) => ({
						metadata,
						isActive,
						signalSchemaSlug,
					}));
				const pluginStateRecords: V1PluginState[] = storedPluginState.map((state) => ({
					id: state.id,
					sortOrder: state.sortOrder,
					isDisabled: state.isDisabled,
					pluginSlug: state.pluginSlug,
					createdAt: state.createdAt.toISOString(),
					updatedAt: state.updatedAt.toISOString(),
					config: decodeV1JsonObject(state.config),
				}));
				const propertyRecords: BackupPropertyRecord[] = [];
				for (const entity of [...userEntities, ...dependencies]) {
					const propertiesSchema = definitions.getEntitySchema(
						entity.entitySchemaSlug,
					)?.propertiesSchema;
					if (propertiesSchema) {
						propertyRecords.push({ propertiesSchema, properties: entity.properties });
					}
				}
				for (const translation of entityDependencies.flatMap(
					({ entitySchemaSlug, translations: dependencyTranslations }) =>
						dependencyTranslations.map((record) => ({ entitySchemaSlug, record })),
				)) {
					const propertiesSchema = definitions.getEntitySchema(
						translation.entitySchemaSlug,
					)?.propertiesSchema;
					if (propertiesSchema && translation.record.properties) {
						propertyRecords.push({ propertiesSchema, properties: translation.record.properties });
					}
				}
				for (const relationship of relationshipRecords) {
					const propertiesSchema = definitions.getRelationshipSchema(
						relationship.relationshipSchemaSlug,
					)?.propertiesSchema;
					if (propertiesSchema) {
						propertyRecords.push({ propertiesSchema, properties: relationship.properties });
					}
				}
				return {
					propertyRecords,
					installedPlugins,
					entityDependencies,
					savedViews: viewRecords,
					pluginState: pluginStateRecords,
					relationships: relationshipRecords,
					notificationSubscriptions: subscriptionRecords,
					entities: userEntities.map(toV1Entity),
					profile: { ...profile, preferences: decodeV1JsonObject(profile.preferences) },
				};
			});

			const readEventPage = Effect.fn("BackupExportSnapshot.readEventPage")(function* (input: {
				userId: UserId;
				afterId?: EventId | undefined;
			}) {
				const rows = yield* events.listUserEventsForBackup(input);
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
				const records: V1Event[] = rows.map((row) => ({
					id: row.id,
					entityId: row.entityId,
					eventSchemaSlug: row.eventSchemaSlug,
					sessionEntityId: row.sessionEntityId,
					createdAt: row.createdAt.toISOString(),
					updatedAt: row.updatedAt.toISOString(),
					occurredAt: row.occurredAt.toISOString(),
					properties: decodeV1JsonObject(row.properties),
				}));
				const propertyRecords = records.flatMap((record): BackupPropertyRecord[] => {
					const entitySchemaSlug = entitySchemaById.get(EntityId.make(record.entityId));
					const propertiesSchema = entitySchemaSlug
						? definitions.getEventSchema(entitySchemaSlug, record.eventSchemaSlug)?.propertiesSchema
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

			const prepareExportSnapshot = Effect.fn("BackupExportSnapshot.prepareExportSnapshot")(
				function* (userId: UserId) {
					const data = yield* readExportData(userId);
					const exportedEvents: V1Event[] = [];
					const eventPropertyRecords: BackupPropertyRecord[] = [];
					let afterId: EventId | undefined;
					let hasNextPage = true;
					while (hasNextPage) {
						const page = yield* readEventPage({ userId, afterId });
						exportedEvents.push(...page.records);
						eventPropertyRecords.push(...page.propertyRecords);
						if (page.nextAfterId === null) {
							hasNextPage = false;
						} else {
							afterId = page.nextAfterId;
						}
					}
					const pluginBySlug = new Map(
						data.installedPlugins.map((plugin) => [plugin.slug, plugin]),
					);
					const additionalPropertyRecords: BackupPropertyRecord[] = [];
					for (const state of data.pluginState) {
						const plugin = pluginBySlug.get(state.pluginSlug);
						if (!plugin) {
							return yield* badRequest(
								`Backup references unavailable plugin '${state.pluginSlug}'`,
							);
						}
						additionalPropertyRecords.push({
							properties: state.config,
							propertiesSchema: plugin.configSchema,
						});
					}
					for (const subscription of data.notificationSubscriptions) {
						const propertiesSchema = yield* requireV1NotificationMetadataSchema(
							subscription,
							definitions.getSignalSchema(subscription.signalSchemaSlug)?.propertiesSchema,
						);
						if (propertiesSchema && isV1JsonObject(subscription.metadata)) {
							additionalPropertyRecords.push({
								propertiesSchema,
								properties: subscription.metadata,
							});
						}
					}
					const requestedLocators = collectManagedAssetLocators([
						...data.propertyRecords,
						...eventPropertyRecords,
						...additionalPropertyRecords,
					]);
					const managedAssets = yield* uploads.verifyManagedAssetOwnership(
						userId,
						requestedLocators,
					);
					const archiveLocators = new Map<string, AssetLocator>(
						managedAssets.map((asset) => [
							locatorKey({ type: asset.provider, key: asset.key }),
							rewriteV1AssetLocatorForArchive(
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
						const redacted = redactV1SchemaSecrets(
							decodeV1JsonObject(properties),
							propertiesSchema,
							path,
						);
						redactions.push(...redacted.redactions);
						return yield* rewriteV1ManagedAssetLocators(
							redacted.redacted,
							propertiesSchema,
							archiveLocators,
						);
					});
					const exportedEntities: V1UserEntity[] = [];
					for (const entity of data.entities) {
						const propertiesSchema = definitions.getEntitySchema(
							entity.entitySchemaSlug,
						)?.propertiesSchema;
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
					const entityDependencies: V1EntityDependency[] = [];
					for (const dependency of data.entityDependencies) {
						const propertiesSchema = definitions.getEntitySchema(
							dependency.entitySchemaSlug,
						)?.propertiesSchema;
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
					const exportedRelationships: V1Relationship[] = [];
					for (const relationship of data.relationships) {
						const propertiesSchema = definitions.getRelationshipSchema(
							relationship.relationshipSchemaSlug,
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
					const entitySchemaById = new Map(
						[...exportedEntities, ...entityDependencies].map(({ id, entitySchemaSlug }) => [
							id,
							entitySchemaSlug,
						]),
					);
					const eventRecords: V1Event[] = [];
					for (const event of exportedEvents) {
						const entitySchemaSlug = entitySchemaById.get(event.entityId);
						const propertiesSchema = entitySchemaSlug
							? definitions.getEventSchema(entitySchemaSlug, event.eventSchemaSlug)
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
					const exportedPluginState: V1PluginState[] = [];
					for (const state of data.pluginState) {
						const plugin = pluginBySlug.get(state.pluginSlug);
						if (!plugin) {
							return yield* badRequest(
								`Backup references unavailable plugin '${state.pluginSlug}'`,
							);
						}
						exportedPluginState.push({
							...state,
							config: yield* transformProperties(
								state.config,
								plugin.configSchema,
								`/plugin-state/${state.id}/config`,
							),
						});
					}
					const notificationSubscriptions: V1NotificationSubscription[] = [];
					for (const subscription of data.notificationSubscriptions) {
						const propertiesSchema = yield* requireV1NotificationMetadataSchema(
							subscription,
							definitions.getSignalSchema(subscription.signalSchemaSlug)?.propertiesSchema,
						);
						notificationSubscriptions.push({
							...subscription,
							metadata:
								propertiesSchema && isV1JsonObject(subscription.metadata)
									? yield* transformProperties(
											subscription.metadata,
											propertiesSchema,
											`/notification-subscriptions/${subscription.signalSchemaSlug}/metadata`,
										)
									: subscription.metadata,
						});
					}
					const requiredPluginSlugs = new Set<string>();
					const addSchemaPlugin = (entitySchemaSlug: string | null | undefined) => {
						const pluginSlug = entitySchemaSlug
							? definitions.getEntitySchema(entitySchemaSlug)?.pluginSlug
							: null;
						if (pluginSlug) {
							requiredPluginSlugs.add(pluginSlug);
						}
					};
					for (const state of exportedPluginState) {
						requiredPluginSlugs.add(state.pluginSlug);
					}
					for (const entity of [...exportedEntities, ...entityDependencies]) {
						addSchemaPlugin(entity.entitySchemaSlug);
						if (entity.provider) {
							requiredPluginSlugs.add(entity.provider.pluginSlug);
						}
					}
					for (const view of data.savedViews) {
						if (view.pluginSlug) {
							requiredPluginSlugs.add(view.pluginSlug);
						}
						addSchemaPlugin(view.entitySchemaSlug);
					}
					for (const relationship of exportedRelationships) {
						const definition = definitions.getRelationshipSchema(
							relationship.relationshipSchemaSlug,
						);
						addSchemaPlugin(definition?.sourceEntitySchemaSlug);
						addSchemaPlugin(definition?.targetEntitySchemaSlug);
						for (const plugin of data.installedPlugins) {
							if (plugin.relationshipSchemaSlugs.includes(relationship.relationshipSchemaSlug)) {
								requiredPluginSlugs.add(plugin.slug);
							}
						}
					}
					for (const subscription of notificationSubscriptions) {
						for (const plugin of data.installedPlugins) {
							if (plugin.signalSchemaSlugs.includes(subscription.signalSchemaSlug)) {
								requiredPluginSlugs.add(plugin.slug);
							}
						}
					}
					const requiredPlugins = [...requiredPluginSlugs]
						.map((slug) => pluginBySlug.get(slug))
						.map((plugin) => (plugin ? { slug: plugin.slug, version: plugin.version } : null));
					if (requiredPlugins.some((plugin) => plugin === null)) {
						return yield* badRequest("Backup references an unavailable plugin");
					}
					return {
						managedAssets,
						redactions: [...new Set(redactions)].sort(),
						requiredPlugins: requiredPlugins.filter((plugin) => plugin !== null),
						records: {
							entityDependencies,
							events: eventRecords,
							profile: data.profile,
							notificationSubscriptions,
							entities: exportedEntities,
							savedViews: data.savedViews,
							pluginState: exportedPluginState,
							relationships: exportedRelationships,
						} satisfies V1ArchiveRecords,
					};
				},
			);

			return { prepareExportSnapshot };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
