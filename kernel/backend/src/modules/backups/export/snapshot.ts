import { badRequest } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { EntityId, EventId, type UserId } from "@ryot-app/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isEqual } from "@ryot-app/ts-utils/lodash";
import { Context, Effect, Encoding, FileSystem, Layer } from "effect";

import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import { ClientPagesRepository } from "#modules/client-pages/repository";
import type { DefinitionSnapshot, SavedViewDefinition } from "#modules/definition-registry/service";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { materializeSavedView } from "#modules/plugins/loader";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";

import {
	collectEmbeddedEntityIds,
	collectReferencedPluginKeys,
	redactSchemaSecrets,
	rewriteAssetLocatorForArchive,
	rewriteManagedAssetLocators,
} from "../archive/references";
import type {
	ArchiveRecords,
	ArchiveEntityDependency,
	ArchiveEvent,
	ArchiveInstallation,
	ArchiveIntegration,
	ArchiveNotificationSubscription,
	ArchiveRelationship,
	ArchiveUserEntity,
} from "../archive/schemas";
import { ARCHIVE_CODECS, decodeArchiveJsonObject, isArchiveJsonObject } from "../archive/schemas";
import { encodeNdjson, IncrementalSha256 } from "../archive/streaming";
import { isDefaultSystemInstallation } from "../installation-state";

type BackupPropertyRecord = {
	readonly propertiesSchema: AppSchema;
	readonly properties: Record<string, unknown>;
};

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

const installationLifecycleIntent = (health: string, isDisabled: boolean) => {
	if (health !== "ready") {
		return "needs-configuration" as const;
	}
	return isDisabled ? ("disabled" as const) : ("ready" as const);
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
		if (property.validation?.asset && isArchiveJsonObject(value)) {
			if (
				(value["type"] === "local" || value["type"] === "s3") &&
				typeof value["key"] === "string"
			) {
				assets.push({ type: value["type"], key: value["key"] });
			}
			return;
		}
		if (isArchiveJsonObject(value)) {
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

const comparePaths = (left: string, right: string) => {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
};

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
	readonly slug: string;
	readonly manifest: PluginManifest;
}): DefinitionSnapshot => ({
	savedViews: Object.fromEntries(
		plugin.manifest.savedViews.map((definition) => [
			definition.slug,
			materializeSavedView(definition, plugin.id, plugin.slug, plugin.manifest.client),
		]),
	),
	signalSchemas: Object.fromEntries(
		plugin.manifest.signalSchemas.map((definition) => [
			definition.slug,
			{ ...definition, pluginId: plugin.id },
		]),
	),
	entitySchemas: Object.fromEntries(
		plugin.manifest.entitySchemas.map((definition) => [
			definition.slug,
			{
				...definition,
				pluginId: plugin.id,
				pluginSlug: plugin.slug,
				mergeIdentityProperties: definition.mergeIdentityProperties ?? [],
				eventSchemas: Object.fromEntries(
					definition.eventSchemas.map((eventSchema) => [
						eventSchema.slug,
						{ ...eventSchema, pluginId: plugin.id },
					]),
				),
			},
		]),
	),
	relationshipSchemas: Object.fromEntries(
		plugin.manifest.relationshipSchemas.map((definition) => [
			definition.slug,
			{ ...definition, pluginId: plugin.id },
		]),
	),
});

const privateDefinitionSnapshots = (
	plugins: ReadonlyArray<{
		readonly id: string;
		readonly slug: string;
		readonly manifest: PluginManifest;
	}>,
) => new Map(plugins.map((plugin) => [plugin.id, privateDefinitionSnapshot(plugin)]));

const definitionLookup =
	<Definition extends { readonly pluginId?: string | null | undefined }>(
		current: Readonly<Record<string, Definition>>,
		historical: (pluginId: string) => Readonly<Record<string, Definition>> | undefined,
	) =>
	(slug: string, pluginId: string | null | undefined) =>
		definitionForPlugin(
			current[slug],
			pluginId,
			pluginId ? historical(pluginId)?.[slug] : undefined,
		);

const definitionLookups = (
	definitions: DefinitionSnapshot,
	historical: ReadonlyMap<string, DefinitionSnapshot>,
) => ({
	savedView: definitionLookup(definitions.savedViews, (id) => historical.get(id)?.savedViews),
	entitySchema: definitionLookup(
		definitions.entitySchemas,
		(id) => historical.get(id)?.entitySchemas,
	),
	signalSchema: definitionLookup(
		definitions.signalSchemas,
		(id) => historical.get(id)?.signalSchemas,
	),
	relationshipSchema: definitionLookup(
		definitions.relationshipSchemas,
		(id) => historical.get(id)?.relationshipSchemas,
	),
});

const toArchiveEntity = Effect.fn(function* (
	entity: PortableEntityRecord,
	pluginKeyById: ReadonlyMap<string, string>,
) {
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
	} satisfies Omit<ArchiveUserEntity, "origin">;
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

const defaultViewState = (view: SavedViewDefinition | undefined) =>
	view
		? {
				slug: view.slug,
				name: view.name,
				icon: view.icon,
				renderer: view.renderer,
				settings: view.settings,
				dataSources: view.dataSources,
				isBuiltin: true,
				sortOrder: view.sortOrder,
				isDisabled: false,
				pluginSlug: view.pluginSlug,
			}
		: null;

export class BackupExportSnapshot extends Context.Service<BackupExportSnapshot>()(
	"BackupExportSnapshot",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthRepository;
			const clientPages = yield* ClientPagesRepository;
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

			const readExportContext = Effect.fn("BackupExportSnapshot.readExportContext")(function* (
				userId: UserId,
				definitions: DefinitionSnapshot,
			) {
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
				const pluginByKey = new Map(
					installedPlugins.map((plugin) => [
						archivePluginKey(plugin.scope, plugin.slug, plugin.sourceHash),
						plugin,
					]),
				);
				const pluginKeyById = new Map(
					installedPlugins.map((plugin) => [
						plugin.id,
						archivePluginKey(plugin.scope, plugin.slug, plugin.sourceHash),
					]),
				);
				return {
					pluginByKey,
					privatePlugins,
					pluginKeyById,
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
				const allStoredInstallations = yield* installations.listForUser(userId);
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
				const storedRelationships = yield* relationships.listUserRelationshipsForBackup(userId);
				const storedIntegrations = yield* integrations.listForBackup(userId);
				const storedViews = yield* savedViews.listForBackup(userId);
				const storedRenderers = yield* clientPages.listRenderers(userId);
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
									id: translation.id,
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
				const homeSavedViewIds = new Set(
					allStoredInstallations.flatMap(({ homeSavedViewId }) =>
						homeSavedViewId === null ? [] : [homeSavedViewId],
					),
				);
				const viewRecords = (yield* Effect.forEach(storedViews, (view) =>
					Effect.gen(function* () {
						const { pluginInstallationId, pluginSlug: _pluginSlug, ...portableView } = view;
						const installation = allStoredInstallations.find(
							(state) => state.id === pluginInstallationId,
						);
						const viewPluginId = installation?.pluginId ?? null;
						const viewDefinition = context.savedView(view.slug, viewPluginId);
						const qualified = {
							pluginKey: viewPluginId ? yield* requirePluginKey(pluginKeyById, viewPluginId) : null,
						};
						const renderer =
							view.renderer.kind === "plugin"
								? {
										exportName: view.renderer.exportName,
										kind: "plugin" as const,
										pluginKey: yield* requirePluginKey(pluginKeyById, view.renderer.pluginId),
									}
								: view.renderer;
						if (!view.isBuiltin) {
							return [
								{
									...portableView,
									...qualified,
									renderer,
									kind: "custom" as const,
									isBuiltin: false as const,
								},
							];
						}
						const expected = defaultViewState(viewDefinition);
						const actual = {
							slug: view.slug,
							name: view.name,
							icon: view.icon,
							renderer: view.renderer,
							settings: view.settings,
							dataSources: view.dataSources,
							isBuiltin: view.isBuiltin,
							sortOrder: view.sortOrder,
							isDisabled: view.isDisabled,
							pluginSlug: view.pluginSlug,
						};
						return expected && isEqual(actual, expected) && !homeSavedViewIds.has(view.id)
							? []
							: [
									{
										...portableView,
										...qualified,
										renderer,
										isBuiltin: true as const,
										kind: "builtin-override" as const,
									},
								];
					}),
				)).flat();
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
				const rendererDependencySlugs = new Set<string>(
					storedRenderers.flatMap(({ draftDefinition, publishedDefinition }) => [
						...draftDefinition.pluginDependencies,
						...(publishedDefinition?.pluginDependencies ?? []),
					]),
				);
				const referencedInstallationIds = new Set([
					...storedIntegrations.map(({ pluginInstallationId }) => pluginInstallationId),
					...storedViews.flatMap(({ pluginInstallationId }) =>
						pluginInstallationId ? [pluginInstallationId] : [],
					),
					...allStoredInstallations.flatMap(({ id, homeSavedViewId }) =>
						homeSavedViewId === null ? [] : [id],
					),
					...storedInstallations.flatMap(({ id, pluginSlug }) =>
						rendererDependencySlugs.has(pluginSlug) ? [id] : [],
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
								id: state.id,
								configuredSecretPaths: [],
								homeSavedViewId: state.homeSavedViewId,
								sortOrder: state.sortOrder,
								disabledIntent: state.isDisabled,
								createdAt: state.createdAt.toISOString(),
								updatedAt: state.updatedAt.toISOString(),
								packageKey: yield* requirePluginKey(pluginKeyById, state.pluginId),
								config: plugin?.scope === "system" ? {} : decodeArchiveJsonObject(state.config),
								lifecycleIntent: installationLifecycleIntent(state.health, state.isDisabled),
							};
						}),
				);
				const installationById = new Map(storedInstallations.map((state) => [state.id, state]));
				const integrationRecords: ArchiveIntegration[] = yield* Effect.forEach(
					storedIntegrations,
					(integration) =>
						Effect.gen(function* () {
							const installation = installationById.get(integration.pluginInstallationId);
							if (!installation) {
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
								packageKey: yield* requirePluginKey(pluginKeyById, installation.pluginId),
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
					dependency.translations.map((record) => ({ dependency, record })),
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
					propertyRecords,
					entityDependencies,
					savedViews: viewRecords,
					integrations: integrationRecords,
					installations: installationRecords,
					relationships: relationshipRecords,
					notificationSubscriptions: subscriptionRecords,
					entities: yield* Effect.forEach(userEntities, (entity) =>
						Effect.gen(function* () {
							return {
								...(yield* toArchiveEntity(entity, pluginKeyById)),
								origin: entity.origin,
							} satisfies ArchiveUserEntity;
						}),
					),
					profile: { ...profile, preferences: decodeArchiveJsonObject(profile.preferences) },
					privatePlugins: yield* Effect.forEach(privatePlugins, (plugin) =>
						Effect.gen(function* () {
							const sourceFiles = yield* plugins.listSourceFiles(plugin.id);
							return {
								key: yield* requirePluginKey(pluginKeyById, plugin.id),
								slug: plugin.slug,
								files: Object.fromEntries(
									Object.entries(sourceFiles)
										.sort(([left], [right]) => comparePaths(left, right))
										.map(([path, contents]) => [path, Encoding.encodeBase64(contents)]),
								),
								manifest: plugin.manifest,
								sourceHash: plugin.sourceHash,
								version: plugin.manifest.metadata.version,
							};
						}),
					),
					clientRenderers: storedRenderers,
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
					const definitions = yield* runtime.getEffectiveDefinitions(userId, true);
					const context = yield* readExportContext(userId, definitions);
					const data = yield* readExportData(userId, context);
					const { pluginByKey, pluginIdForKey, pluginKeyById } = context;
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
							locatorKey({ type: asset.provider, key: asset.key }),
							rewriteAssetLocatorForArchive({ type: asset.provider, key: asset.key }, asset.sha256),
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
						);
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
					const restoredIntegrations: ArchiveIntegration[] = [];
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
						clientRenderers: data.clientRenderers,
						relationships: exportedRelationships,
						installations: exportedInstallations,
					} satisfies ArchiveRecords;
					const referencedPluginKeys = collectReferencedPluginKeys(records);
					const requiredPlugins = context.installedPlugins
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
