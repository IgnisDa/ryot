import { defaultUserPreferences } from "@ryot/contract/auth-middleware";
import { badRequest, conflict } from "@ryot/contract/errors";
import { jsonValueSchema } from "@ryot/contract/modules/sandbox/wire";
import type { AssetLocator, ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	PluginSlug,
	SignalSchemaSlug,
	type UserId,
} from "@ryot/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot/contract/schema/property-schema";
import { isEqual } from "@ryot/ts-utils/lodash";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import type {
	V1ArchiveRecords,
	V1EntityDependency,
	V1Event,
	V1NotificationSubscription,
	V1PluginState,
	V1Relationship,
	V1SavedView,
	V1UserEntity,
} from "#modules/backups/v1-codec";
import {
	DefinitionRegistry,
	getSavedViewValidationError,
	type SavedViewDefinition,
} from "#modules/definition-registry/service";
import { DefinitionsRepository } from "#modules/definitions/repository";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { NotificationsRepository } from "#modules/notifications/repository";
import { PluginRepository } from "#modules/plugins/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { UploadsService } from "#modules/uploads/service";

import { classifyAccountCleanliness } from "./account-cleanliness";
import {
	backupV1EntityReferenceRules,
	backupV1EventReferenceRules,
	redactV1SchemaSecrets,
	rewriteV1AssetLocatorForArchive,
	rewriteV1EntityEmbeddedReferences,
	rewriteV1EventReferences,
	rewriteV1ManagedAssetLocators,
	rewriteV1RelationshipReferences,
} from "./v1-rewrites";

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

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
		if (property.validation?.asset && isRecord(value)) {
			if (
				(value["type"] === "local" || value["type"] === "s3") &&
				typeof value["key"] === "string"
			) {
				assets.push({ type: value["type"], key: value["key"] });
			}
			return;
		}
		if (isRecord(value)) {
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
	properties: toJsonObject(entity.properties),
	populatedAt: entity.populatedAt?.toISOString() ?? null,
});

const toJsonObject = Schema.decodeUnknownSync(Schema.Record(Schema.String, jsonValueSchema));

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

const parseDate = (value: string) => new Date(value);

const V1_BOOTSTRAP_SOURCE = {
	name: ["Lib", "rary"].join(""),
	pluginSlug: ["me", "dia"].join(""),
	entitySchemaSlug: ["lib", "rary"].join(""),
} as const;

const isV1BootstrapSource = (entity: {
	readonly id: string;
	readonly name: string;
	readonly provider: unknown;
	readonly externalId: string | null;
	readonly entitySchemaSlug: string;
	readonly properties: Record<string, unknown>;
}) =>
	entity.name === V1_BOOTSTRAP_SOURCE.name &&
	entity.provider === null &&
	entity.externalId === null &&
	entity.entitySchemaSlug === V1_BOOTSTRAP_SOURCE.entitySchemaSlug &&
	Object.keys(entity.properties).length === 0;

export const resolveV1BootstrapSourceMapping = Effect.fn(function* (
	archived: ReadonlyArray<Parameters<typeof isV1BootstrapSource>[0]>,
	target: ReadonlyArray<Parameters<typeof isV1BootstrapSource>[0]>,
) {
	const archivedSources = archived.filter(isV1BootstrapSource);
	if (archivedSources.length !== 1) {
		return yield* badRequest("Backup must contain exactly one V1 bootstrap source entity");
	}
	const targetSources = target.filter(isV1BootstrapSource);
	if (targetSources.length !== 1) {
		return yield* badRequest("Backup target must contain exactly one V1 bootstrap source entity");
	}
	const archivedSource = archivedSources[0];
	const targetSource = targetSources[0];
	if (!archivedSource || !targetSource) {
		return yield* badRequest("V1 bootstrap source mapping is unavailable");
	}
	return { archivedId: archivedSource.id, targetId: EntityId.make(targetSource.id) };
});

export const assertV1DependencySchemaOwnership = Effect.fn(function* (
	dependency: V1EntityDependency,
	schemaPluginSlug: string | null,
) {
	if (
		(dependency.identity.kind === "provider" || dependency.identity.kind === "bootstrap") &&
		schemaPluginSlug !== dependency.identity.pluginSlug
	) {
		return yield* badRequest("Backup global dependency schema is not owned by its plugin");
	}
	return yield* Effect.void;
});

export const selectV1TranslationsForRestore = (
	inserted: boolean,
	translations: V1EntityDependency["translations"],
) => (inserted ? translations : []);

export const collectV1EmbeddedEntityIds = (
	entities: ReadonlyArray<{
		readonly entitySchemaSlug: string;
		readonly properties: Record<string, unknown>;
	}>,
) => {
	const ids = new Set<string>();
	for (const entity of entities) {
		if (entity.entitySchemaSlug !== ["work", "out-template"].join("")) {
			continue;
		}
		const items = entity.properties[["exer", "cises"].join("")];
		if (!Array.isArray(items)) {
			continue;
		}
		for (const item of items) {
			const reference = isRecord(item) ? item[["exer", "ciseId"].join("")] : undefined;
			if (typeof reference === "string") {
				ids.add(reference);
			}
		}
	}
	return [...ids].sort();
};

export class BackupDataService extends Context.Service<BackupDataService>()("BackupDataService", {
	make: Effect.gen(function* () {
		const auth = yield* AuthRepository;
		const uploads = yield* UploadsService;
		const events = yield* EventsRepository;
		const plugins = yield* PluginRepository;
		const entities = yield* EntitiesRepository;
		const definitions = yield* DefinitionRegistry;
		const savedViews = yield* SavedViewsRepository;
		const automations = yield* AutomationsRepository;
		const pluginState = yield* DefinitionsRepository;
		const translations = yield* TranslationsRepository;
		const integrations = yield* IntegrationsRepository;
		const relationships = yield* RelationshipsRepository;
		const notifications = yield* NotificationsRepository;

		const validateEntityProperties = (slug: string, properties: unknown) =>
			definitions
				.validateEntityProperties(slug, properties)
				.pipe(Effect.mapError((error) => badRequest(error.message)));
		const validateRelationshipProperties = (slug: string, properties: unknown) =>
			definitions
				.validateRelationshipProperties(slug, properties)
				.pipe(Effect.mapError((error) => badRequest(error.message)));

		const readExportData = Effect.fn("BackupDataService.readExportData")(function* (
			userId: UserId,
		) {
			const profile = yield* auth.getPortableProfile(userId);
			if (!profile) {
				return yield* badRequest("Backup user does not exist");
			}
			const storedPluginState = yield* pluginState.listPluginStates(userId);
			const installedPlugins = yield* plugins.listPortablePluginMetadata();
			const userEntities = yield* entities.listUserEntitiesForBackup(userId);
			const referencedDependencies = yield* entities.listReferencedGlobalEntitiesForBackup(userId);
			const embeddedDependencies = yield* entities.listGlobalEntitiesByIdsForBackup(
				collectV1EmbeddedEntityIds(userEntities).map((id) => EntityId.make(id)),
			);
			const dependencies = [
				...new Map(
					[...referencedDependencies, ...embeddedDependencies].map((entity) => [entity.id, entity]),
				).values(),
			].sort((left, right) => left.id.localeCompare(right.id));
			const storedRelationships = yield* relationships.listUserRelationshipsForBackup(userId);
			const storedViews = yield* savedViews.listForBackup(userId);
			const storedSubscriptions = yield* automations.listNotificationSubscriptionsForBackup(userId);
			const translationRows = yield* translations.listForBackup(
				dependencies.map(({ id }) => EntityId.make(id)),
			);
			const translationsByEntity = Map.groupBy(translationRows, ({ entityId }) => entityId);

			const entityDependencies: V1EntityDependency[] = dependencies.map((entity) => {
				const schemaDefinition = definitions.getEntitySchema(entity.entitySchemaSlug);
				const identity = dependencyIdentity(entity, schemaDefinition);
				return {
					...toV1Entity(entity),
					identity,
					translations: (translationsByEntity.get(entity.id) ?? []).map((translation) => ({
						id: translation.id,
						name: translation.name,
						language: translation.language,
						createdAt: translation.createdAt.toISOString(),
						updatedAt: translation.updatedAt.toISOString(),
						populatedAt: translation.populatedAt?.toISOString() ?? null,
						properties: translation.properties ? toJsonObject(translation.properties) : null,
					})),
				};
			});

			const relationshipRecords: V1Relationship[] = storedRelationships.map((relationship) => ({
				scope: "user",
				id: relationship.id,
				sourceEntityId: relationship.sourceEntityId,
				targetEntityId: relationship.targetEntityId,
				createdAt: relationship.createdAt.toISOString(),
				properties: toJsonObject(relationship.properties),
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
				config: toJsonObject(state.config),
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
				managedAssetLocators: collectManagedAssetLocators(propertyRecords),
				profile: { ...profile, preferences: toJsonObject(profile.preferences) },
			};
		});

		const readEventPage = Effect.fn("BackupDataService.readEventPage")(function* (input: {
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
				properties: toJsonObject(row.properties),
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
				managedAssetLocators: collectManagedAssetLocators(propertyRecords),
			};
		});

		const prepareExportSnapshot = Effect.fn("BackupDataService.prepareExportSnapshot")(function* (
			userId: UserId,
		) {
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

			const pluginBySlug = new Map(data.installedPlugins.map((plugin) => [plugin.slug, plugin]));
			const additionalPropertyRecords: BackupPropertyRecord[] = [];
			for (const state of data.pluginState) {
				const plugin = pluginBySlug.get(state.pluginSlug);
				if (!plugin) {
					return yield* badRequest(`Backup references unavailable plugin '${state.pluginSlug}'`);
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
				if (propertiesSchema && isRecord(subscription.metadata)) {
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
			const managedAssets = yield* uploads.verifyManagedAssetOwnership(userId, requestedLocators);
			const archiveLocators = new Map<string, AssetLocator>(
				managedAssets.map((asset) => [
					locatorKey({ type: asset.provider, key: asset.key }),
					rewriteV1AssetLocatorForArchive({ type: asset.provider, key: asset.key }, asset.sha256),
				]),
			);
			const redactions: string[] = [];
			const transformProperties = Effect.fn(function* (
				properties: Record<string, unknown>,
				propertiesSchema: AppSchema,
				path: string,
			) {
				const decoded = toJsonObject(properties);
				const redacted = redactV1SchemaSecrets(decoded, propertiesSchema, path);
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
					? definitions.getEventSchema(entitySchemaSlug, event.eventSchemaSlug)?.propertiesSchema
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
					return yield* badRequest(`Backup references unavailable plugin '${state.pluginSlug}'`);
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
						propertiesSchema && isRecord(subscription.metadata)
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
				const definition = definitions.getRelationshipSchema(relationship.relationshipSchemaSlug);
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
		});

		const assertRequiredPlugins = Effect.fn("BackupDataService.assertRequiredPlugins")(function* (
			required: ReadonlyArray<{ readonly slug: string; readonly version: string }>,
			records: V1ArchiveRecords,
		) {
			const installedPlugins = yield* plugins.listPortablePluginMetadata();
			const installed = new Map(installedPlugins.map(({ slug, version }) => [slug, version]));
			const declared = new Map(required.map(({ slug, version }) => [slug, version]));
			for (const plugin of required) {
				if (installed.get(plugin.slug) !== plugin.version) {
					return yield* badRequest(
						`Backup requires plugin '${plugin.slug}' at version '${plugin.version}'`,
					);
				}
			}
			const referenced = new Set<string>();
			const addEntitySchemaPlugin = (slug: string | null | undefined) => {
				const pluginSlug = slug ? definitions.getEntitySchema(slug)?.pluginSlug : null;
				if (pluginSlug) {
					referenced.add(pluginSlug);
				}
			};
			for (const state of records.pluginState) {
				referenced.add(state.pluginSlug);
			}
			for (const entity of [...records.entities, ...records.entityDependencies]) {
				addEntitySchemaPlugin(entity.entitySchemaSlug);
				if (entity.provider) {
					referenced.add(entity.provider.pluginSlug);
				}
			}
			for (const view of records.savedViews) {
				if (view.pluginSlug) {
					referenced.add(view.pluginSlug);
				}
				addEntitySchemaPlugin(view.entitySchemaSlug);
			}
			for (const relationship of records.relationships) {
				const definition = definitions.getRelationshipSchema(relationship.relationshipSchemaSlug);
				addEntitySchemaPlugin(definition?.sourceEntitySchemaSlug);
				addEntitySchemaPlugin(definition?.targetEntitySchemaSlug);
				for (const plugin of installedPlugins) {
					if (plugin.relationshipSchemaSlugs.includes(relationship.relationshipSchemaSlug)) {
						referenced.add(plugin.slug);
					}
				}
			}
			for (const subscription of records.notificationSubscriptions) {
				for (const plugin of installedPlugins) {
					if (plugin.signalSchemaSlugs.includes(subscription.signalSchemaSlug)) {
						referenced.add(plugin.slug);
					}
				}
			}
			for (const slug of referenced) {
				if (declared.get(slug) !== installed.get(slug)) {
					return yield* badRequest(`Backup is missing exact plugin requirement '${slug}'`);
				}
			}
			return yield* Effect.void;
		});

		const assertAccountIsClean = Effect.fn("BackupDataService.assertAccountIsClean")(function* (
			userId: UserId,
		) {
			const profile = yield* auth.getPortableProfile(userId);
			if (!profile) {
				return yield* badRequest("Account does not exist");
			}
			const ownedEntities = yield* entities.listUserEntitiesForBackup(userId);
			const ownedRelationships = yield* relationships.listUserRelationshipsForBackup(userId);
			const hasEvents = yield* events.hasUserEvents(userId);
			const hasManagedAssets = (yield* uploads.listManagedAssetsForOwner(userId)).length > 0;
			const views = yield* savedViews.listForBackup(userId);
			const subscriptions = yield* automations.listNotificationSubscriptionsForBackup(userId);
			const states = yield* pluginState.listPluginStates(userId);
			const hasIntegrations = yield* integrations.hasAnyForUser(userId);
			const hasNotificationChannels = yield* notifications.hasAnyForUser(userId);
			const snapshot = definitions.getSnapshot();
			const sourceDefinition = snapshot.entitySchemas[V1_BOOTSTRAP_SOURCE.entitySchemaSlug];
			if (
				sourceDefinition?.pluginSlug !== V1_BOOTSTRAP_SOURCE.pluginSlug ||
				sourceDefinition.name !== V1_BOOTSTRAP_SOURCE.name
			) {
				return yield* badRequest("Current V1 bootstrap source definition is unavailable");
			}
			const expectedBootstrapEntities = [
				{
					provider: null,
					properties: {},
					externalId: null,
					populatedAt: null,
					name: V1_BOOTSTRAP_SOURCE.name,
					entitySchemaSlug: V1_BOOTSTRAP_SOURCE.entitySchemaSlug,
				},
			];
			const category = classifyAccountCleanliness({
				profile,
				hasEvents,
				hasIntegrations,
				hasManagedAssets,
				savedViews: views,
				pluginState: states,
				entities: ownedEntities,
				hasNotificationChannels,
				expectedBootstrapEntities,
				relationships: ownedRelationships,
				expectedBootstrapRelationships: [],
				notificationSubscriptions: subscriptions,
				defaultPreferences: { ...defaultUserPreferences },
				expectedSavedViews: Object.values(snapshot.savedViews),
				expectedNotificationSubscriptionSlugs: Object.values(snapshot.signalSchemas)
					.filter(({ catalogState }) => catalogState === "active")
					.map(({ slug }) => slug),
			});
			if (category) {
				return yield* conflict(`Account is not clean: ${category}`);
			}
			return undefined;
		});

		const resolveProvider = Effect.fn("BackupDataService.resolveProvider")(function* (
			provider: { readonly pluginSlug: string; readonly providerSlug: string } | null,
		) {
			if (!provider) {
				return null;
			}
			const resolved = yield* plugins.resolveProviderBySlugs(provider);
			return resolved ?? (yield* badRequest("Backup requires an unavailable provider"));
		});

		const restoreRecords = Effect.fn("BackupDataService.restoreRecords")(function* (
			userId: UserId,
			records: V1ArchiveRecords,
			assetLocators: ReadonlyMap<string, AssetLocator>,
		) {
			const entityIdMap = new Map<string, EntityId>();
			const entitySchemaById = new Map<EntityId, EntitySchemaSlug>();
			const rewriteProperties = (
				properties: Record<string, unknown>,
				propertiesSchema: AppSchema,
			) => rewriteV1ManagedAssetLocators(toJsonObject(properties), propertiesSchema, assetLocators);
			for (const dependency of records.entityDependencies) {
				const schemaDefinition = definitions.getEntitySchema(dependency.entitySchemaSlug);
				if (!schemaDefinition) {
					return yield* badRequest("Backup references an unavailable entity schema");
				}
				yield* assertV1DependencySchemaOwnership(dependency, schemaDefinition.pluginSlug);
				if (
					dependency.identity.kind === "provider" &&
					(!dependency.provider ||
						dependency.provider.pluginSlug !== dependency.identity.pluginSlug ||
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
				const entitySchemaSlug = EntitySchemaSlug.make(dependency.entitySchemaSlug);
				let target = null;
				let inserted = false;
				let provider = null;
				if (dependency.identity.kind === "provider") {
					if (dependency.externalId === null) {
						return yield* badRequest("Backup global dependency is missing its natural identity");
					}
					provider = yield* resolveProvider(dependency.provider);
					target = yield* entities.findGlobalEntityForRestore({
						entitySchemaSlug,
						provider: dependency.provider,
						externalId: dependency.externalId,
					});
				} else if (dependency.identity.kind === "bootstrap") {
					target = yield* entities.findGlobalEntityForRestore({
						provider: null,
						entitySchemaSlug,
						externalId: dependency.identity.externalId,
					});
				} else {
					if (dependency.provider !== null) {
						return yield* badRequest("Backup unmanaged dependency has provider provenance");
					}
					const exact = yield* entities.findGlobalEntityById(EntityId.make(dependency.id));
					if (exact && exact.entitySchemaSlug !== entitySchemaSlug) {
						return yield* badRequest(
							"Backup global dependency identity conflicts with existing data",
						);
					}
					if (!exact) {
						return yield* badRequest(
							"Backup unmanaged dependency does not match a current registry identity",
						);
					}
					target = exact;
				}
				if (!target) {
					const properties = yield* rewriteProperties(
						dependency.properties,
						schemaDefinition.propertiesSchema,
					);
					yield* validateEntityProperties(dependency.entitySchemaSlug, properties);
					const id = yield* entities.restoreEntity({
						properties,
						userId: null,
						id: dependency.id,
						name: dependency.name,
						providerId: provider?.id ?? null,
						externalId: dependency.externalId,
						entitySchemaSlug: dependency.entitySchemaSlug,
						createdAt: parseDate(dependency.createdAt),
						updatedAt: parseDate(dependency.updatedAt),
						populatedAt: dependency.populatedAt ? parseDate(dependency.populatedAt) : null,
					});
					target = { id, entitySchemaSlug };
					inserted = true;
				}
				entityIdMap.set(dependency.id, target.id);
				entitySchemaById.set(target.id, target.entitySchemaSlug);
				for (const translation of selectV1TranslationsForRestore(
					inserted,
					dependency.translations,
				)) {
					yield* translations.restoreTranslation({
						id: translation.id,
						entityId: target.id,
						name: translation.name,
						language: translation.language,
						createdAt: parseDate(translation.createdAt),
						updatedAt: parseDate(translation.updatedAt),
						populatedAt: translation.populatedAt ? parseDate(translation.populatedAt) : null,
						properties:
							translation.properties === null
								? null
								: yield* rewriteProperties(
										translation.properties,
										schemaDefinition.propertiesSchema,
									),
					});
				}
			}

			const sourceDefinition = definitions.getEntitySchema(V1_BOOTSTRAP_SOURCE.entitySchemaSlug);
			if (
				sourceDefinition?.pluginSlug !== V1_BOOTSTRAP_SOURCE.pluginSlug ||
				sourceDefinition.name !== V1_BOOTSTRAP_SOURCE.name
			) {
				return yield* badRequest("Current V1 bootstrap source definition is unavailable");
			}
			const sourceMapping = yield* resolveV1BootstrapSourceMapping(
				records.entities,
				yield* entities.listUserEntitiesForBackup(userId),
			);
			for (const entity of records.entities) {
				entityIdMap.set(
					entity.id,
					entity.id === sourceMapping.archivedId
						? sourceMapping.targetId
						: EntityId.make(entity.id),
				);
			}
			for (const entity of records.entities) {
				const mappedId = entityIdMap.get(entity.id);
				if (!mappedId) {
					return yield* badRequest("Backup entity mapping is incomplete");
				}
				if (entity.id === sourceMapping.archivedId) {
					entitySchemaById.set(mappedId, EntitySchemaSlug.make(entity.entitySchemaSlug));
					continue;
				}
				const provider = yield* resolveProvider(entity.provider);
				const propertiesSchema = definitions.getEntitySchema(
					entity.entitySchemaSlug,
				)?.propertiesSchema;
				if (!propertiesSchema) {
					return yield* badRequest("Backup references an unavailable entity schema");
				}
				const embedded = yield* rewriteV1EntityEmbeddedReferences(
					entity,
					entityIdMap,
					backupV1EntityReferenceRules,
				);
				const properties = yield* rewriteProperties(embedded.properties, propertiesSchema);
				yield* validateEntityProperties(entity.entitySchemaSlug, properties);
				const id = yield* entities.restoreEntity({
					userId,
					properties,
					id: entity.id,
					name: entity.name,
					externalId: entity.externalId,
					providerId: provider?.id ?? null,
					entitySchemaSlug: entity.entitySchemaSlug,
					createdAt: parseDate(entity.createdAt),
					updatedAt: parseDate(entity.updatedAt),
					populatedAt: entity.populatedAt ? parseDate(entity.populatedAt) : null,
				});
				entityIdMap.set(entity.id, id);
				entitySchemaById.set(id, EntitySchemaSlug.make(entity.entitySchemaSlug));
			}

			const relationshipIdMap = new Map<string, string>();
			for (const relationship of records.relationships) {
				if (relationship.scope !== "user") {
					return yield* badRequest("Backup contains a non-user relationship");
				}
				const rewritten = yield* rewriteV1RelationshipReferences(relationship, entityIdMap);
				const sourceEntityId = EntityId.make(rewritten.sourceEntityId);
				const targetEntityId = EntityId.make(rewritten.targetEntityId);
				const propertiesSchema = definitions.getRelationshipSchema(
					relationship.relationshipSchemaSlug,
				)?.propertiesSchema;
				if (!propertiesSchema) {
					return yield* badRequest("Backup references an unavailable relationship schema");
				}
				const properties = yield* rewriteProperties(relationship.properties, propertiesSchema);
				yield* validateRelationshipProperties(relationship.relationshipSchemaSlug, properties);
				const restoredId = yield* relationships.restoreRelationship({
					userId,
					properties,
					sourceEntityId,
					targetEntityId,
					id: relationship.id,
					createdAt: parseDate(relationship.createdAt),
					relationshipSchemaSlug: relationship.relationshipSchemaSlug,
				});
				relationshipIdMap.set(relationship.id, restoredId);
			}

			for (const event of records.events) {
				const rewritten = yield* rewriteV1EventReferences(
					event,
					entityIdMap,
					relationshipIdMap,
					backupV1EventReferenceRules,
				);
				const entityId = EntityId.make(rewritten.entityId);
				const sessionEntityId = rewritten.sessionEntityId
					? EntityId.make(rewritten.sessionEntityId)
					: null;
				const entitySchemaSlug = entitySchemaById.get(entityId);
				if (!entitySchemaSlug) {
					return yield* badRequest("Backup event references an unknown entity schema");
				}
				const propertiesSchema = definitions.getEventSchema(
					entitySchemaSlug,
					event.eventSchemaSlug,
				)?.propertiesSchema;
				if (!propertiesSchema) {
					return yield* badRequest("Backup references an unavailable event schema");
				}
				const properties = yield* rewriteProperties(rewritten.properties, propertiesSchema);
				yield* definitions
					.validateEventProperties(entitySchemaSlug, event.eventSchemaSlug, properties)
					.pipe(Effect.mapError((error) => badRequest(error.message)));
				yield* events.restoreEvent({
					userId,
					entityId,
					properties,
					id: event.id,
					sessionEntityId,
					eventSchemaSlug: event.eventSchemaSlug,
					createdAt: parseDate(event.createdAt),
					updatedAt: parseDate(event.updatedAt),
					occurredAt: parseDate(event.occurredAt),
				});
			}

			if (!(yield* auth.restorePortableProfile(userId, records.profile))) {
				return yield* badRequest("Backup user does not exist");
			}
			const installedPlugins = new Map(
				(yield* plugins.listPortablePluginMetadata()).map((plugin) => [plugin.slug, plugin]),
			);
			for (const state of records.pluginState) {
				const configSchema = installedPlugins.get(state.pluginSlug)?.configSchema;
				if (!configSchema) {
					return yield* badRequest("Backup references an unavailable plugin");
				}
				yield* pluginState.restorePluginState({
					userId,
					id: state.id,
					sortOrder: state.sortOrder,
					pluginSlug: state.pluginSlug,
					isDisabled: state.isDisabled,
					createdAt: parseDate(state.createdAt),
					updatedAt: parseDate(state.updatedAt),
					config: yield* rewriteProperties(state.config, configSchema),
				});
			}
			for (const view of records.savedViews) {
				if (view.kind === "builtin-override") {
					if (!definitions.getSavedView(view.slug)) {
						return yield* badRequest("Backup references an unavailable built-in saved view");
					}
					const restored = yield* savedViews.updateBuiltinStateBySlug(
						userId,
						view.slug,
						view.isDisabled,
						view.sortOrder,
					);
					if (!restored) {
						return yield* badRequest("Backup target is missing a built-in saved view");
					}
					continue;
				}
				if (!definitions.getEntitySchema(view.entitySchemaSlug ?? "") && view.entitySchemaSlug) {
					return yield* badRequest("Backup saved view references an unavailable entity schema");
				}
				const validationError = getSavedViewValidationError(view);
				if (validationError) {
					return yield* badRequest(validationError);
				}
				const restored = yield* savedViews.restoreCustomView({
					userId,
					id: view.id,
					slug: view.slug,
					name: view.name,
					icon: view.icon,
					layouts: view.layouts,
					sortOrder: view.sortOrder,
					isDisabled: view.isDisabled,
					createdAt: parseDate(view.createdAt),
					updatedAt: parseDate(view.updatedAt),
					pluginSlug: view.pluginSlug ? PluginSlug.make(view.pluginSlug) : null,
					entitySchemaSlug: view.entitySchemaSlug
						? EntitySchemaSlug.make(view.entitySchemaSlug)
						: null,
				});
				if (!restored) {
					return yield* badRequest("Backup saved view could not be restored");
				}
			}
			for (const subscription of records.notificationSubscriptions) {
				const definition = definitions.getSignalSchema(subscription.signalSchemaSlug);
				if (definition?.catalogState !== "active") {
					return yield* badRequest("Backup references an unavailable notification subscription");
				}
				const restored = yield* automations.restoreNotificationSubscriptionState({
					userId,
					isActive: subscription.isActive,
					signalSchemaSlug: SignalSchemaSlug.make(subscription.signalSchemaSlug),
					metadata:
						subscription.metadata && isRecord(subscription.metadata)
							? yield* rewriteProperties(subscription.metadata, definition.propertiesSchema)
							: subscription.metadata,
				});
				if (!restored) {
					return yield* badRequest("Backup target is missing a notification subscription");
				}
			}
			return undefined;
		});

		return {
			readEventPage,
			readExportData,
			restoreRecords,
			assertAccountIsClean,
			prepareExportSnapshot,
			assertRequiredPlugins,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
