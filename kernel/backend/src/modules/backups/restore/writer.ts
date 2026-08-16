import { badRequest, DbError } from "@ryot/contract/errors";
import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	SignalSchemaSlug,
	type UserId,
} from "@ryot/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot/contract/schema/property-schema";
import { Context, Data, Effect, Layer, Stream } from "effect";

import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import {
	type DefinitionSnapshot,
	formatSavedViewValidationIssue,
	validateSavedViewLayouts,
} from "#modules/definition-registry/service";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository, RESTORE_EVENT_BATCH_SIZE } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import type { ValidatedV2Events } from "../archive-v2/archive";
import { archiveError } from "../archive-v2/error";
import {
	rewriteV2EventReferences,
	rewriteV2ManagedAssetLocators,
	rewriteV2PropertyReferences,
	rewriteV2RelationshipReferences,
} from "../archive-v2/references";
import {
	decodeV2JsonObject,
	isV2JsonObject,
	type V2ArchiveRecords,
	type V2EntityDependency,
	type V2Installation,
} from "../archive-v2/schemas";

export class RequiredBackupPluginUnavailable extends Data.TaggedError(
	"RequiredBackupPluginUnavailable",
)<{ readonly pluginSlug: string; readonly requiredVersion: string }> {}

export const resolveV2RequiredPluginIds = Effect.fn(function* (
	required: ReadonlyArray<{
		readonly slug: string;
		readonly version: string;
		readonly sourceHash: string;
	}>,
	installedPlugins: ReadonlyArray<{
		readonly id: string;
		readonly slug: string;
		readonly version: string;
		readonly sourceHash: string;
	}>,
) {
	const installed = new Map(installedPlugins.map((plugin) => [plugin.slug, plugin]));
	const pluginIdByKey = new Map<string, string>();
	for (const plugin of required) {
		const target = installed.get(plugin.slug);
		if (target?.version !== plugin.version || target.sourceHash !== plugin.sourceHash) {
			return yield* new RequiredBackupPluginUnavailable({
				pluginSlug: plugin.slug,
				requiredVersion: plugin.version,
			});
		}
		pluginIdByKey.set(`system:${plugin.slug}:${plugin.sourceHash}`, target.id);
	}
	return pluginIdByKey;
});

const parseDate = (value: string) => new Date(value);

const decodePointerSegment = (value: string) => value.replaceAll("~1", "/").replaceAll("~0", "~");

export const isV2RequiredSecretPath = (path: string, schema: AppSchema) => {
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

export const resolveV2RestoredInstallationLifecycle = (
	state: Pick<V2Installation, "configuredSecretPaths" | "disabledIntent" | "lifecycleIntent">,
	schema: AppSchema,
) => {
	const missingRequiredSecret =
		state.lifecycleIntent === "needs-configuration" ||
		state.configuredSecretPaths.some((path) => isV2RequiredSecretPath(path, schema));
	return {
		isDisabled: missingRequiredSecret ? true : state.disabledIntent,
		health: missingRequiredSecret ? ("needs-configuration" as const) : ("ready" as const),
	};
};

export const resolveV2RestoredIntegrationDisabled = (
	integration: {
		readonly isDisabled: boolean;
		readonly configuredSecretPaths: ReadonlyArray<string>;
	},
	schema: AppSchema,
) =>
	integration.isDisabled ||
	integration.configuredSecretPaths.some((path) => isV2RequiredSecretPath(path, schema));

const validateProperties = (properties: unknown, propertiesSchema: AppSchema, kind: string) =>
	parseAppSchemaProperties({ properties, propertiesSchema, kind }).pipe(
		Effect.mapError((error) => badRequest(error.message)),
	);

const bootstrapSchemaIdentity = (entitySchemaSlug: string, entitySchemaPluginId: string | null) =>
	JSON.stringify([entitySchemaSlug, entitySchemaPluginId]);

type ArchivedBootstrapEntity = Pick<
	V2ArchiveRecords["entities"][number],
	"id" | "origin" | "entitySchemaSlug" | "entitySchemaPluginKey"
>;
type TargetBootstrapEntity = Pick<
	PortableEntityRecord,
	"id" | "origin" | "entitySchemaSlug" | "entitySchemaPluginId"
>;

export const resolveV2BootstrapEntityMappings = Effect.fn(function* (
	archived: ReadonlyArray<ArchivedBootstrapEntity>,
	target: ReadonlyArray<TargetBootstrapEntity>,
	pluginIdByKey: ReadonlyMap<string, string>,
) {
	const archivedByIdentity = new Map<string, Array<ArchivedBootstrapEntity>>();
	for (const entity of archived) {
		if (entity.origin?.kind !== "bootstrap") {
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
		if (entity.origin?.kind !== "bootstrap") {
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
		if (archivedEntities.length !== 1 || targetEntities.length !== 1) {
			return yield* badRequest("Backup bootstrap entity identity is ambiguous");
		}
		const archivedEntity = archivedEntities[0];
		const targetEntity = targetEntities[0];
		if (!archivedEntity || !targetEntity) {
			return yield* badRequest("Backup bootstrap entity mapping is unavailable");
		}
		mappings.set(archivedEntity.id, EntityId.make(targetEntity.id));
	}
	return mappings;
});

export const assertV2DependencySchemaOwnership = Effect.fn(function* (
	dependency: V2EntityDependency,
	schemaPluginKey: string | null,
) {
	if (
		(dependency.identity.kind === "provider" || dependency.identity.kind === "bootstrap") &&
		schemaPluginKey !== dependency.identity.pluginKey
	) {
		return yield* badRequest("Backup global dependency schema is not owned by its plugin");
	}
	return yield* Effect.void;
});

export const selectV2TranslationsForRestore = (
	inserted: boolean,
	translations: V2EntityDependency["translations"],
) => (inserted ? translations : []);

export const preflightV2Provenance = Effect.fn(function* (
	records: V2ArchiveRecords,
	archivedEvents: ValidatedV2Events,
	pluginIdByKey: ReadonlyMap<string, string>,
	definitions: DefinitionSnapshot,
) {
	const mappedPluginId = Effect.fn(function* (key: string | null) {
		if (key === null) {
			return null;
		}
		const pluginId = pluginIdByKey.get(key);
		return pluginId ?? (yield* badRequest(`Backup references unmapped plugin key '${key}'`));
	});
	const assertOwner = Effect.fn(function* (
		key: string | null,
		definition: { readonly pluginId?: string | null | undefined } | undefined,
		kind: string,
	) {
		if (!definition) {
			return yield* badRequest(`Backup references an unavailable ${kind}`);
		}
		if ((yield* mappedPluginId(key)) !== (definition.pluginId ?? null)) {
			return yield* badRequest(`Backup ${kind} provenance has the wrong plugin owner`);
		}
		return yield* Effect.void;
	});
	const assertProvider = Effect.fn(function* (provider: { readonly pluginKey: string } | null) {
		if (provider) {
			yield* mappedPluginId(provider.pluginKey);
		}
	});

	for (const installation of records.installations) {
		yield* mappedPluginId(installation.packageKey);
	}
	for (const integration of records.integrations) {
		yield* mappedPluginId(integration.packageKey);
	}
	for (const entity of records.entities) {
		yield* assertOwner(
			entity.entitySchemaPluginKey,
			definitions.entitySchemas[entity.entitySchemaSlug],
			"entity schema",
		);
		yield* assertProvider(entity.provider);
	}
	for (const dependency of records.entityDependencies) {
		yield* assertOwner(
			dependency.entitySchemaPluginKey,
			definitions.entitySchemas[dependency.entitySchemaSlug],
			"entity schema",
		);
		yield* assertProvider(dependency.provider);
		if (dependency.identity.kind !== "unmanaged") {
			yield* mappedPluginId(dependency.identity.pluginKey);
		}
	}
	for (const relationship of records.relationships) {
		yield* assertOwner(
			relationship.relationshipSchemaPluginKey,
			definitions.relationshipSchemas[relationship.relationshipSchemaSlug],
			"relationship schema",
		);
	}
	for (const view of records.savedViews) {
		if (view.kind === "builtin-override") {
			yield* assertOwner(view.pluginKey, definitions.savedViews[view.slug], "saved view");
		} else if (view.pluginKey !== null) {
			yield* mappedPluginId(view.pluginKey);
		}
		if (view.entitySchemaSlug !== null) {
			yield* assertOwner(
				view.entitySchemaPluginKey,
				definitions.entitySchemas[view.entitySchemaSlug],
				"saved view entity schema",
			);
		} else if (view.entitySchemaPluginKey !== null) {
			return yield* badRequest("Backup saved view entity schema provenance is inconsistent");
		}
	}
	for (const subscription of records.notificationSubscriptions) {
		yield* assertOwner(
			subscription.signalSchemaPluginKey,
			definitions.signalSchemas[subscription.signalSchemaSlug],
			"signal schema",
		);
	}
	const entitySchemaById = new Map(
		[...records.entities, ...records.entityDependencies].map(({ id, entitySchemaSlug }) => [
			id,
			entitySchemaSlug,
		]),
	);
	yield* Stream.runForEach(archivedEvents.read(), (event) =>
		Effect.gen(function* () {
			const entitySchemaSlug = entitySchemaById.get(event.entityId);
			const definition = entitySchemaSlug
				? definitions.entitySchemas[entitySchemaSlug]?.eventSchemas[event.eventSchemaSlug]
				: undefined;
			yield* assertOwner(event.eventSchemaPluginKey, definition, "event schema");
		}),
	);
	return yield* Effect.void;
});

export class BackupRestoreWriter extends Context.Service<BackupRestoreWriter>()(
	"BackupRestoreWriter",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthRepository;
			const events = yield* EventsRepository;
			const plugins = yield* PluginRepository;
			const entities = yield* EntitiesRepository;
			const savedViews = yield* SavedViewsRepository;
			const automations = yield* AutomationsRepository;
			const integrations = yield* IntegrationsRepository;
			const translations = yield* TranslationsRepository;
			const relationships = yield* RelationshipsRepository;
			const installations = yield* PluginInstallationRepository;

			const assertRequiredPlugins = Effect.fn("BackupRestoreWriter.assertRequiredPlugins")(
				function* (
					required: ReadonlyArray<{
						readonly slug: string;
						readonly version: string;
						readonly sourceHash: string;
					}>,
				) {
					return yield* resolveV2RequiredPluginIds(
						required,
						yield* plugins.listPortablePluginMetadata(),
					);
				},
			);

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
				records: V2ArchiveRecords,
				assetLocators: ReadonlyMap<string, AssetLocator>,
				archivedEvents: ValidatedV2Events,
				pluginIdByKey: ReadonlyMap<string, string>,
				definitions: DefinitionSnapshot,
			) {
				const installedPlugins = new Map(
					[
						...(yield* plugins.listPortablePluginMetadata()),
						...(yield* plugins.listPrivateForUser(userId)).map((plugin) => ({
							id: plugin.id,
							slug: plugin.slug,
							configSchema: plugin.manifest.configSchema,
							integrationProviders: plugin.manifest.integrationProviders,
						})),
					].map((plugin) => [plugin.id, plugin]),
				);
				const installationIdByKey = new Map<string, string>();
				const installationActivations: Array<{
					readonly id: string;
					readonly updatedAt: Date;
					readonly isDisabled: boolean;
					readonly health: "ready" | "needs-configuration";
				}> = [];
				const pluginKeyById = new Map([...pluginIdByKey].map(([key, id]) => [id, key]));
				for (const state of records.installations) {
					const pluginId = pluginIdByKey.get(state.packageKey);
					const installedPlugin = pluginId ? installedPlugins.get(pluginId) : undefined;
					if (!pluginId || !installedPlugin || installationIdByKey.has(state.packageKey)) {
						return yield* badRequest("Backup plugin installation mapping is invalid");
					}
					const lifecycle = resolveV2RestoredInstallationLifecycle(
						state,
						installedPlugin.configSchema,
					);
					const restored = yield* installations.restore({
						userId,
						pluginId,
						id: state.id,
						isDisabled: true,
						health: "installing",
						sortOrder: state.sortOrder,
						preserveExistingConfig: state.packageKey.startsWith("system:"),
						createdAt: parseDate(state.createdAt),
						updatedAt: parseDate(state.updatedAt),
						config: yield* rewriteV2ManagedAssetLocators(
							decodeV2JsonObject(state.config),
							installedPlugin.configSchema,
							assetLocators,
						),
					});
					if (!restored) {
						return yield* badRequest("Backup plugin installation could not be restored");
					}
					installationIdByKey.set(state.packageKey, restored.id);
					installationActivations.push({
						id: restored.id,
						health: lifecycle.health,
						isDisabled: lifecycle.isDisabled,
						updatedAt: parseDate(state.updatedAt),
					});
				}
				const getEntitySchema = (slug: string) => definitions.entitySchemas[slug];
				const getRelationshipSchema = (slug: string) => definitions.relationshipSchemas[slug];
				yield* savedViews.restoreBuiltinViews(
					userId,
					Object.values(definitions.savedViews)
						.filter(
							({ pluginId }) =>
								pluginId !== null &&
								pluginId !== undefined &&
								pluginKeyById.get(pluginId)?.startsWith("user:") === true,
						)
						.map(({ slug, name, icon, layouts, sortOrder, pluginId, entitySchemaSlug }) => ({
							slug,
							name,
							icon,
							layouts,
							sortOrder,
							entitySchemaSlug: entitySchemaSlug ? EntitySchemaSlug.make(entitySchemaSlug) : null,
							pluginInstallationId: pluginId
								? (installationIdByKey.get(pluginKeyById.get(pluginId) ?? "") ?? null)
								: null,
							entitySchemaPluginId: entitySchemaSlug
								? (definitions.entitySchemas[entitySchemaSlug]?.pluginId ?? null)
								: null,
						})),
				);
				for (const integration of records.integrations) {
					const pluginId = pluginIdByKey.get(integration.packageKey);
					const plugin = pluginId ? installedPlugins.get(pluginId) : undefined;
					const provider = plugin?.integrationProviders.find(
						(definition) =>
							definition.slug === integration.provider && definition.lot === integration.lot,
					);
					const pluginInstallationId = installationIdByKey.get(integration.packageKey);
					if (!plugin || !provider || !pluginInstallationId) {
						return yield* badRequest("Backup integration mapping is invalid");
					}
					const providerSpecifics = yield* rewriteV2ManagedAssetLocators(
						decodeV2JsonObject(integration.providerSpecifics),
						provider.settingsSchema,
						assetLocators,
					);
					yield* integrations.restoreForUser({
						userId,
						providerSpecifics,
						id: integration.id,
						lot: integration.lot,
						pluginInstallationId,
						name: integration.name,
						provider: integration.provider,
						extraSettings: integration.extraSettings,
						syncOwnership: integration.syncOwnership,
						minimumProgress: integration.minimumProgress,
						maximumProgress: integration.maximumProgress,
						createdAt: parseDate(integration.createdAt),
						updatedAt: parseDate(integration.updatedAt),
						isDisabled: resolveV2RestoredIntegrationDisabled(integration, provider.settingsSchema),
						lastFinishedAt: integration.lastFinishedAt
							? parseDate(integration.lastFinishedAt)
							: null,
					});
				}
				const entityIdMap = new Map<string, EntityId>();
				const relationshipIdMap = new Map<string, string>();
				const entitySchemaById = new Map<EntityId, EntitySchemaSlug>();
				const rewriteProperties = (
					properties: Record<string, unknown>,
					propertiesSchema: AppSchema,
				) =>
					Effect.gen(function* () {
						const references = yield* rewriteV2PropertyReferences(
							decodeV2JsonObject(properties),
							propertiesSchema,
							entityIdMap,
							relationshipIdMap,
						);
						return yield* rewriteV2ManagedAssetLocators(
							references,
							propertiesSchema,
							assetLocators,
						);
					});
				for (const dependency of records.entityDependencies) {
					const schemaDefinition = getEntitySchema(dependency.entitySchemaSlug);
					if (!schemaDefinition) {
						return yield* badRequest("Backup references an unavailable entity schema");
					}
					yield* assertV2DependencySchemaOwnership(
						dependency,
						schemaDefinition.pluginId
							? (pluginKeyById.get(schemaDefinition.pluginId) ?? null)
							: null,
					);
					if (
						dependency.identity.kind === "provider" &&
						(!dependency.provider ||
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
					const entitySchemaSlug = EntitySchemaSlug.make(dependency.entitySchemaSlug);
					const entitySchemaPluginId = dependency.entitySchemaPluginKey
						? (pluginIdByKey.get(dependency.entitySchemaPluginKey) ?? null)
						: null;
					let target = null;
					let inserted = false;
					let provider = null;
					if (dependency.identity.kind === "provider") {
						const archivedProvider = dependency.provider;
						if (dependency.externalId === null || archivedProvider === null) {
							return yield* badRequest("Backup global dependency is missing its natural identity");
						}
						provider = yield* resolveProvider(pluginIdByKey, archivedProvider);
						const providerPluginId = pluginIdByKey.get(archivedProvider.pluginKey);
						const providerPlugin = providerPluginId
							? installedPlugins.get(providerPluginId)
							: undefined;
						if (!providerPlugin) {
							return yield* badRequest("Backup provider plugin mapping is unavailable");
						}
						target = yield* entities.findGlobalEntityForRestore({
							entitySchemaSlug,
							entitySchemaPluginId,
							provider: {
								providerSlug: archivedProvider.providerSlug,
								pluginSlug: providerPlugin.slug,
							},
							externalId: dependency.externalId,
						});
					} else if (dependency.identity.kind === "bootstrap") {
						target = yield* entities.findGlobalEntityForRestore({
							provider: null,
							entitySchemaSlug,
							entitySchemaPluginId,
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
						yield* validateProperties(
							properties,
							schemaDefinition.propertiesSchema,
							"Entity properties",
						);
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
							entitySchemaPluginId: dependency.entitySchemaPluginKey
								? (pluginIdByKey.get(dependency.entitySchemaPluginKey) ?? null)
								: null,
						});
						target = { id, entitySchemaSlug };
						inserted = true;
					}
					entityIdMap.set(dependency.id, target.id);
					entitySchemaById.set(target.id, target.entitySchemaSlug);
					for (const translation of selectV2TranslationsForRestore(
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

				const bootstrapMappings = yield* resolveV2BootstrapEntityMappings(
					records.entities,
					yield* entities.listUserEntitiesForBackup(userId),
					pluginIdByKey,
				);
				for (const entity of records.entities) {
					entityIdMap.set(entity.id, bootstrapMappings.get(entity.id) ?? EntityId.make(entity.id));
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
					const propertiesSchema = getEntitySchema(entity.entitySchemaSlug)?.propertiesSchema;
					if (!propertiesSchema) {
						return yield* badRequest("Backup references an unavailable entity schema");
					}
					const properties = yield* rewriteProperties(entity.properties, propertiesSchema);
					yield* validateProperties(properties, propertiesSchema, "Entity properties");
					const id = yield* entities.restoreEntity({
						userId,
						properties,
						id: entity.id,
						name: entity.name,
						origin: entity.origin,
						externalId: entity.externalId,
						providerId: provider?.id ?? null,
						entitySchemaSlug: entity.entitySchemaSlug,
						createdAt: parseDate(entity.createdAt),
						updatedAt: parseDate(entity.updatedAt),
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
					const rewritten = yield* rewriteV2RelationshipReferences(relationship, entityIdMap);
					const sourceEntityId = EntityId.make(rewritten.sourceEntityId);
					const targetEntityId = EntityId.make(rewritten.targetEntityId);
					const propertiesSchema = getRelationshipSchema(
						relationship.relationshipSchemaSlug,
					)?.propertiesSchema;
					if (!propertiesSchema) {
						return yield* badRequest("Backup references an unavailable relationship schema");
					}
					const properties = yield* rewriteProperties(relationship.properties, propertiesSchema);
					yield* validateProperties(properties, propertiesSchema, "Relationship properties");
					const restoredId = yield* relationships.restoreRelationship({
						userId,
						properties,
						sourceEntityId,
						targetEntityId,
						id: relationship.id,
						createdAt: parseDate(relationship.createdAt),
						relationshipSchemaSlug: relationship.relationshipSchemaSlug,
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
						const propertiesSchema =
							getEntitySchema(entitySchemaSlug)?.eventSchemas[event.eventSchemaSlug]
								?.propertiesSchema;
						if (!propertiesSchema) {
							return yield* badRequest("Backup references an unavailable event schema");
						}
						const rewritten = yield* rewriteV2EventReferences(
							event,
							propertiesSchema,
							entityIdMap,
							relationshipIdMap,
						);
						const sessionEntityId = rewritten.sessionEntityId
							? EntityId.make(rewritten.sessionEntityId)
							: null;
						const properties = yield* rewriteV2ManagedAssetLocators(
							rewritten.properties,
							propertiesSchema,
							assetLocators,
						);
						yield* validateProperties(properties, propertiesSchema, "Event properties");
						eventBatch.push({
							userId,
							entityId,
							properties,
							id: event.id,
							sessionEntityId,
							createdAt: parseDate(event.createdAt),
							updatedAt: parseDate(event.updatedAt),
							occurredAt: parseDate(event.occurredAt),
							eventSchemaSlug: event.eventSchemaSlug,
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

				if (!(yield* auth.restorePortableProfile(userId, records.profile))) {
					return yield* badRequest("Backup user does not exist");
				}
				for (const view of records.savedViews) {
					if (view.kind === "builtin-override") {
						if (!definitions.savedViews[view.slug]) {
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
					if (!getEntitySchema(view.entitySchemaSlug ?? "") && view.entitySchemaSlug) {
						return yield* badRequest("Backup saved view references an unavailable entity schema");
					}
					const validationIssue = validateSavedViewLayouts(view);
					if (validationIssue) {
						return yield* badRequest(formatSavedViewValidationIssue(validationIssue));
					}
					const pluginInstallationId = view.pluginKey
						? installationIdByKey.get(view.pluginKey)
						: null;
					if (view.pluginKey && !pluginInstallationId) {
						return yield* badRequest("Backup saved view installation mapping is invalid");
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
						pluginInstallationId,
						entitySchemaPluginId: view.entitySchemaPluginKey
							? (pluginIdByKey.get(view.entitySchemaPluginKey) ?? null)
							: null,
						entitySchemaSlug: view.entitySchemaSlug
							? EntitySchemaSlug.make(view.entitySchemaSlug)
							: null,
					});
					if (!restored) {
						return yield* badRequest("Backup saved view could not be restored");
					}
				}
				for (const subscription of records.notificationSubscriptions) {
					const definition = definitions.signalSchemas[subscription.signalSchemaSlug];
					if (definition?.catalogState !== "active") {
						return yield* badRequest("Backup references an unavailable notification subscription");
					}
					const restored = yield* automations.restoreNotificationSubscriptionState({
						userId,
						isActive: subscription.isActive,
						signalSchemaSlug: SignalSchemaSlug.make(subscription.signalSchemaSlug),
						signalSchemaPluginId: subscription.signalSchemaPluginKey
							? (pluginIdByKey.get(subscription.signalSchemaPluginKey) ?? null)
							: null,
						metadata:
							subscription.metadata && isV2JsonObject(subscription.metadata)
								? yield* rewriteProperties(subscription.metadata, definition.propertiesSchema)
								: subscription.metadata,
					});
					if (!restored) {
						return yield* badRequest("Backup target is missing a notification subscription");
					}
				}
				for (const activation of installationActivations) {
					if (!(yield* installations.activateRestored(activation))) {
						return yield* badRequest("Backup plugin installation could not be activated");
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
