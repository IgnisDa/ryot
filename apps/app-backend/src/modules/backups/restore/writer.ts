import { badRequest, DbError } from "@ryot/contract/errors";
import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	PluginSlug,
	SignalSchemaSlug,
	type UserId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Context, Effect, Layer, Stream } from "effect";

import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import {
	DefinitionRegistry,
	getSavedViewValidationError,
} from "#modules/definition-registry/service";
import { DefinitionsRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository, RESTORE_EVENT_BATCH_SIZE } from "#modules/events/repository";
import { PluginRepository } from "#modules/plugins/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import type { ValidatedV1Events } from "../archive-v1/archive";
import { archiveError } from "../archive-v1/error";
import {
	rewriteV1EventReferences,
	rewriteV1ManagedAssetLocators,
	rewriteV1PropertyReferences,
	rewriteV1RelationshipReferences,
} from "../archive-v1/references";
import {
	decodeV1JsonObject,
	isV1JsonObject,
	V1_BOOTSTRAP_SOURCE,
	type V1ArchiveRecords,
	type V1EntityDependency,
} from "../archive-v1/schemas";

const parseDate = (value: string) => new Date(value);

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

export class BackupRestoreWriter extends Context.Service<BackupRestoreWriter>()(
	"BackupRestoreWriter",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthRepository;
			const events = yield* EventsRepository;
			const plugins = yield* PluginRepository;
			const entities = yield* EntitiesRepository;
			const definitions = yield* DefinitionRegistry;
			const savedViews = yield* SavedViewsRepository;
			const automations = yield* AutomationsRepository;
			const pluginState = yield* DefinitionsRepository;
			const translations = yield* TranslationsRepository;
			const relationships = yield* RelationshipsRepository;

			const validateEntityProperties = (slug: string, properties: unknown) =>
				definitions
					.validateEntityProperties(slug, properties)
					.pipe(Effect.mapError((error) => badRequest(error.message)));
			const validateRelationshipProperties = (slug: string, properties: unknown) =>
				definitions
					.validateRelationshipProperties(slug, properties)
					.pipe(Effect.mapError((error) => badRequest(error.message)));

			const assertRequiredPlugins = Effect.fn("BackupRestoreWriter.assertRequiredPlugins")(
				function* (
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
						const definition = definitions.getRelationshipSchema(
							relationship.relationshipSchemaSlug,
						);
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
				},
			);

			const resolveProvider = Effect.fn(function* (
				provider: { readonly pluginSlug: string; readonly providerSlug: string } | null,
			) {
				if (!provider) {
					return null;
				}
				const resolved = yield* plugins.resolveProviderBySlugs(provider);
				return resolved ?? (yield* badRequest("Backup requires an unavailable provider"));
			});

			const restoreEventBatch = (
				batch: ReadonlyArray<Parameters<typeof events.restoreEvents>[0][number]>,
			) =>
				events
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
				records: V1ArchiveRecords,
				assetLocators: ReadonlyMap<string, AssetLocator>,
				archivedEvents: ValidatedV1Events,
			) {
				const entityIdMap = new Map<string, EntityId>();
				const relationshipIdMap = new Map<string, string>();
				const entitySchemaById = new Map<EntityId, EntitySchemaSlug>();
				const rewriteProperties = (
					properties: Record<string, unknown>,
					propertiesSchema: AppSchema,
				) =>
					Effect.gen(function* () {
						const references = yield* rewriteV1PropertyReferences(
							decodeV1JsonObject(properties),
							propertiesSchema,
							entityIdMap,
							relationshipIdMap,
						);
						return yield* rewriteV1ManagedAssetLocators(
							references,
							propertiesSchema,
							assetLocators,
						);
					});
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
					const properties = yield* rewriteProperties(entity.properties, propertiesSchema);
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
						const propertiesSchema = definitions.getEventSchema(
							entitySchemaSlug,
							event.eventSchemaSlug,
						)?.propertiesSchema;
						if (!propertiesSchema) {
							return yield* badRequest("Backup references an unavailable event schema");
						}
						const rewritten = yield* rewriteV1EventReferences(
							event,
							propertiesSchema,
							entityIdMap,
							relationshipIdMap,
						);
						const sessionEntityId = rewritten.sessionEntityId
							? EntityId.make(rewritten.sessionEntityId)
							: null;
						const properties = yield* rewriteV1ManagedAssetLocators(
							rewritten.properties,
							propertiesSchema,
							assetLocators,
						);
						yield* definitions
							.validateEventProperties(entitySchemaSlug, event.eventSchemaSlug, properties)
							.pipe(Effect.mapError((error) => badRequest(error.message)));
						eventBatch.push({
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
						return yield* eventBatch.length >= RESTORE_EVENT_BATCH_SIZE
							? restoreEventBatch(eventBatch.splice(0))
							: Effect.void;
					}),
				);
				yield* restoreEventBatch(eventBatch.splice(0));

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
							subscription.metadata && isV1JsonObject(subscription.metadata)
								? yield* rewriteProperties(subscription.metadata, definition.propertiesSchema)
								: subscription.metadata,
					});
					if (!restored) {
						return yield* badRequest("Backup target is missing a notification subscription");
					}
				}
				return undefined;
			});

			return { restoreRecords, assertRequiredPlugins };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
