import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { dataJsonIntegrationSettingsSchema } from "@ryot-app/contract/modules/imports/data-json";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { UserId } from "@ryot-app/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { and, asc, type Column, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { collectManagedAssetLocators } from "#lib/domain/managed-asset-locators";
import { DefinitionRepository } from "#modules/definitions/repository";
import type { DefinitionSnapshot } from "#modules/definitions/snapshot";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

const PAGE_SIZE = 100;

const containsLocator = (value: unknown, locator: ManagedAssetLocator): boolean => {
	if (Array.isArray(value)) {
		return value.some((item) => containsLocator(item, locator));
	}
	if (!isObjectRecord(value)) {
		return false;
	}
	if (value["type"] === locator.type && value["key"] === locator.key) {
		return true;
	}
	return Object.values(value).some((child) => containsLocator(child, locator));
};

const recordHasLocator = (
	properties: unknown,
	propertiesSchema: AppSchema | null | undefined,
	locator: ManagedAssetLocator,
) =>
	propertiesSchema && isObjectRecord(properties)
		? collectManagedAssetLocators([{ properties, propertiesSchema }], true).some(
				(candidate) => candidate.type === locator.type && candidate.key === locator.key,
			)
		: containsLocator(properties, locator);

const schemaDeclaresAsset = (property: AppPropertyDefinition): boolean => {
	if (property.type === "object") {
		return (
			property.validation?.asset === true ||
			Object.values(property.properties).some(schemaDeclaresAsset)
		);
	}
	return property.type === "array" && schemaDeclaresAsset(property.items);
};

const schemaHasAssets = (schema: AppSchema | null | undefined) =>
	schema !== null && schema !== undefined && Object.values(schema.fields).some(schemaDeclaresAsset);

const payloadHasReference = (
	payload: unknown,
	snapshot: DefinitionSnapshot,
	locator: ManagedAssetLocator,
): boolean => {
	if (!isObjectRecord(payload)) {
		return false;
	}
	const resource = payload["resource"];
	if (payload["operation"] === "batch" && Array.isArray(payload["items"])) {
		return payload["items"].some((item) => payloadHasReference(item, snapshot, locator));
	}
	const propertyRecordHasReference = (record: unknown) => {
		if (!isObjectRecord(record)) {
			return false;
		}
		let propertiesSchema: AppSchema | undefined;
		if (resource === "entity" && typeof record["entitySchemaSlug"] === "string") {
			propertiesSchema =
				snapshot.entitySchemas[
					definitionKey(
						"entity",
						definitionOwner(
							typeof record["entitySchemaPluginId"] === "string"
								? record["entitySchemaPluginId"]
								: null,
						),
						record["entitySchemaSlug"],
					)
				]?.propertiesSchema;
		} else if (
			resource === "event" &&
			typeof record["entitySchemaSlug"] === "string" &&
			typeof record["eventSchemaSlug"] === "string"
		) {
			propertiesSchema =
				snapshot.entitySchemas[
					definitionKey(
						"entity",
						definitionOwner(
							typeof record["entitySchemaPluginId"] === "string"
								? record["entitySchemaPluginId"]
								: null,
						),
						record["entitySchemaSlug"],
					)
				]?.eventSchemas[record["eventSchemaSlug"]]?.propertiesSchema;
		} else if (
			resource === "relationship" &&
			typeof record["relationshipSchemaSlug"] === "string"
		) {
			propertiesSchema =
				snapshot.relationshipSchemas[
					definitionKey(
						"relationship",
						definitionOwner(
							typeof record["relationshipSchemaPluginId"] === "string"
								? record["relationshipSchemaPluginId"]
								: null,
						),
						record["relationshipSchemaSlug"],
					)
				]?.propertiesSchema;
		} else if (resource === "signal" && typeof record["signalSchemaSlug"] === "string") {
			propertiesSchema =
				snapshot.signalSchemas[
					definitionKey(
						"signal",
						definitionOwner(
							typeof record["signalSchemaPluginId"] === "string"
								? record["signalSchemaPluginId"]
								: null,
						),
						record["signalSchemaSlug"],
					)
				]?.propertiesSchema;
		}
		return recordHasLocator(record["properties"], propertiesSchema, locator);
	};
	if (resource === "signal" && propertyRecordHasReference(payload)) {
		return true;
	}
	for (const key of ["draft", "before", "after"]) {
		if (propertyRecordHasReference(payload[key])) {
			return true;
		}
	}
	const population = payload["population"];
	return (
		isObjectRecord(population) &&
		isObjectRecord(population["parentEntity"]) &&
		propertyRecordHasReference({
			...population["parentEntity"],
			entitySchemaSlug: population["parentEntity"]["entitySchemaSlug"],
			entitySchemaPluginId: population["parentEntity"]["entitySchemaPluginId"],
		})
	);
};

export class ManagedAssetReferencesRepository extends Context.Service<ManagedAssetReferencesRepository>()(
	"ManagedAssetReferencesRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const definitions = yield* DefinitionRepository;

			const hasReference = Effect.fn("ManagedAssetReferencesRepository.hasReference")(function* (
				ownerUserId: UserId,
				locator: ManagedAssetLocator,
			) {
				const ownedOrUnowned = (column: Column) => or(eq(column, ownerUserId), isNull(column));
				const globalSnapshot = yield* definitions.getGlobalSnapshot;
				const userSnapshots = new Map<UserId, typeof globalSnapshot>();
				const snapshotForOwner = Effect.fnUntraced(function* (userId: UserId | null) {
					if (userId === null) {
						return globalSnapshot;
					}
					let snapshot = userSnapshots.get(userId);
					if (!snapshot) {
						snapshot = yield* definitions.getUserSnapshot(userId, { listed: true });
						userSnapshots.set(userId, snapshot);
					}
					return snapshot;
				});

				let afterEntityId: string | undefined;
				let hasMoreEntities = true;
				while (hasMoreEntities) {
					const rows = yield* session.run((db) =>
						db
							.select({
								id: tables.entity.id,
								userId: tables.entity.userId,
								properties: tables.entity.properties,
								schemaSlug: tables.entity.entitySchemaSlug,
								schemaPluginId: tables.entity.entitySchemaPluginId,
							})
							.from(tables.entity)
							.where(
								and(
									ownedOrUnowned(tables.entity.userId),
									afterEntityId === undefined ? undefined : gt(tables.entity.id, afterEntityId),
								),
							)
							.orderBy(asc(tables.entity.id))
							.limit(PAGE_SIZE),
					);
					for (const row of rows) {
						const snapshot = yield* snapshotForOwner(
							row.userId === null ? null : UserId.make(row.userId),
						);
						const entitySchema =
							snapshot.entitySchemas[
								definitionKey("entity", definitionOwner(row.schemaPluginId), row.schemaSlug)
							];
						if (recordHasLocator(row.properties, entitySchema?.propertiesSchema, locator)) {
							return true;
						}
					}
					if (rows.length < PAGE_SIZE) {
						hasMoreEntities = false;
					} else {
						afterEntityId = rows.at(-1)?.id;
					}
				}

				const translations = yield* session.run((db) =>
					db
						.select({
							userId: tables.entity.userId,
							schemaSlug: tables.entity.entitySchemaSlug,
							properties: tables.entityTranslation.properties,
							schemaPluginId: tables.entity.entitySchemaPluginId,
						})
						.from(tables.entityTranslation)
						.innerJoin(tables.entity, eq(tables.entity.id, tables.entityTranslation.entityId))
						.where(ownedOrUnowned(tables.entity.userId)),
				);
				for (const row of translations) {
					const snapshot = yield* snapshotForOwner(
						row.userId === null ? null : UserId.make(row.userId),
					);
					const entitySchema =
						snapshot.entitySchemas[
							definitionKey("entity", definitionOwner(row.schemaPluginId), row.schemaSlug)
						];
					if (recordHasLocator(row.properties, entitySchema?.propertiesSchema, locator)) {
						return true;
					}
				}

				const relationships = yield* session.run((db) =>
					db
						.select({
							id: tables.relationship.id,
							userId: tables.relationship.userId,
							properties: tables.relationship.properties,
							schemaSlug: tables.relationship.relationshipSchemaSlug,
							schemaPluginId: tables.relationship.relationshipSchemaPluginId,
						})
						.from(tables.relationship)
						.where(ownedOrUnowned(tables.relationship.userId))
						.orderBy(asc(tables.relationship.id)),
				);
				for (const row of relationships) {
					const snapshot = yield* snapshotForOwner(
						row.userId === null ? null : UserId.make(row.userId),
					);
					const relationshipSchema =
						snapshot.relationshipSchemas[
							definitionKey("relationship", definitionOwner(row.schemaPluginId), row.schemaSlug)
						];
					if (recordHasLocator(row.properties, relationshipSchema?.propertiesSchema, locator)) {
						return true;
					}
				}

				let afterEventId: string | undefined;
				let hasMoreEvents = true;
				while (hasMoreEvents) {
					const rows = yield* session.run((db) =>
						db
							.select({
								id: tables.event.id,
								userId: tables.event.userId,
								properties: tables.event.properties,
								eventSchemaSlug: tables.event.eventSchemaSlug,
								entitySchemaSlug: tables.entity.entitySchemaSlug,
								eventSchemaPluginId: tables.event.eventSchemaPluginId,
								entitySchemaPluginId: tables.entity.entitySchemaPluginId,
							})
							.from(tables.event)
							.innerJoin(tables.entity, eq(tables.entity.id, tables.event.entityId))
							.where(
								and(
									eq(tables.event.userId, ownerUserId),
									afterEventId === undefined ? undefined : gt(tables.event.id, afterEventId),
								),
							)
							.orderBy(asc(tables.event.id))
							.limit(PAGE_SIZE),
					);
					for (const row of rows) {
						const snapshot = yield* snapshotForOwner(ownerUserId);
						const entitySchema =
							snapshot.entitySchemas[
								definitionKey(
									"entity",
									definitionOwner(row.entitySchemaPluginId),
									row.entitySchemaSlug,
								)
							];
						const eventSchema =
							row.eventSchemaPluginId === row.entitySchemaPluginId
								? entitySchema?.eventSchemas[row.eventSchemaSlug]
								: undefined;
						if (recordHasLocator(row.properties, eventSchema?.propertiesSchema, locator)) {
							return true;
						}
					}
					if (rows.length < PAGE_SIZE) {
						hasMoreEvents = false;
					} else {
						afterEventId = rows.at(-1)?.id;
					}
				}

				const installations = yield* session.run((db) =>
					db
						.select({
							configSchema: tables.pluginRevision.configSchema,
							clientConfig: tables.pluginInstallation.clientConfig,
							userSettings: tables.pluginInstallation.userSettings,
							clientConfigSchema: tables.pluginRevision.clientConfigSchema,
							userSettingsSchema: tables.pluginRevision.userSettingsSchema,
							activeConfigRevisionId: tables.pluginInstallation.activeConfigRevisionId,
						})
						.from(tables.pluginInstallation)
						.innerJoin(tables.plugin, eq(tables.plugin.id, tables.pluginInstallation.pluginId))
						.leftJoin(
							tables.pluginRevision,
							eq(tables.pluginRevision.id, tables.plugin.activeRevisionId),
						)
						.where(eq(tables.pluginInstallation.userId, ownerUserId)),
				);
				for (const installation of installations) {
					if (
						recordHasLocator(installation.clientConfig, installation.clientConfigSchema, locator) ||
						recordHasLocator(installation.userSettings, installation.userSettingsSchema, locator)
					) {
						return true;
					}
					if (
						installation.activeConfigRevisionId &&
						(!installation.configSchema || schemaHasAssets(installation.configSchema))
					) {
						return true;
					}
				}

				const archivedConfigs = yield* session.run((db) =>
					db
						.select({ configSchema: tables.pluginRevision.configSchema })
						.from(tables.pluginConfigRevision)
						.innerJoin(
							tables.pluginRevision,
							eq(tables.pluginRevision.id, tables.pluginConfigRevision.pluginRevisionId),
						)
						.where(
							and(
								isNotNull(tables.pluginConfigRevision.encryptedPayload),
								ownedOrUnowned(tables.pluginConfigRevision.ownerUserId),
							),
						),
				);
				if (archivedConfigs.some(({ configSchema }) => schemaHasAssets(configSchema))) {
					return true;
				}

				const integrations = yield* session.run((db) =>
					db
						.select({
							provider: tables.integration.provider,
							providerSpecifics: tables.integration.providerSpecifics,
							integrationProviders: tables.pluginRevision.integrationProviders,
						})
						.from(tables.integration)
						.leftJoin(
							tables.pluginInstallation,
							eq(tables.pluginInstallation.id, tables.integration.pluginInstallationId),
						)
						.leftJoin(tables.plugin, eq(tables.plugin.id, tables.pluginInstallation.pluginId))
						.leftJoin(
							tables.pluginRevision,
							eq(tables.pluginRevision.id, tables.plugin.activeRevisionId),
						)
						.where(eq(tables.integration.userId, ownerUserId)),
				);
				for (const integration of integrations) {
					const provider = integration.integrationProviders?.find(
						(candidate) => candidate.slug === integration.provider,
					);
					const propertiesSchema =
						integration.provider === "data-json"
							? dataJsonIntegrationSettingsSchema
							: provider?.settingsSchema;
					if (recordHasLocator(integration.providerSpecifics, propertiesSchema, locator)) {
						return true;
					}
				}

				const subscriptions = yield* session.run((db) =>
					db
						.select({
							userId: tables.notificationSubscription.userId,
							metadata: tables.notificationSubscription.metadata,
							signalSchemaSlug: tables.notificationSubscription.signalSchemaSlug,
							signalSchemaPluginId: tables.notificationSubscription.signalSchemaPluginId,
						})
						.from(tables.notificationSubscription)
						.where(eq(tables.notificationSubscription.userId, ownerUserId)),
				);
				for (const subscription of subscriptions) {
					const snapshot = yield* snapshotForOwner(ownerUserId);
					const signalSchema =
						snapshot.signalSchemas[
							definitionKey(
								"signal",
								definitionOwner(subscription.signalSchemaPluginId),
								subscription.signalSchemaSlug,
							)
						];
					if (recordHasLocator(subscription.metadata, signalSchema?.propertiesSchema, locator)) {
						return true;
					}
				}

				let afterTriggerId: string | undefined;
				let hasMoreTriggers = true;
				while (hasMoreTriggers) {
					const triggers = yield* session.run((db) =>
						db
							.select({
								id: tables.automationTrigger.id,
								payload: tables.automationTrigger.payload,
								scopeUserId: tables.automationTrigger.scopeUserId,
							})
							.from(tables.automationTrigger)
							.where(
								and(
									ownedOrUnowned(tables.automationTrigger.scopeUserId),
									afterTriggerId === undefined
										? undefined
										: gt(tables.automationTrigger.id, afterTriggerId),
								),
							)
							.orderBy(asc(tables.automationTrigger.id))
							.limit(PAGE_SIZE),
					);
					for (const { payload, scopeUserId } of triggers) {
						const snapshot = yield* snapshotForOwner(
							scopeUserId === null ? null : UserId.make(scopeUserId),
						);
						if (payloadHasReference(payload, snapshot, locator)) {
							return true;
						}
					}
					if (triggers.length < PAGE_SIZE) {
						hasMoreTriggers = false;
					} else {
						afterTriggerId = triggers.at(-1)?.id;
					}
				}

				const savedViews = yield* session.run((db) =>
					db
						.select({ settings: tables.savedView.settings })
						.from(tables.savedView)
						.where(eq(tables.savedView.userId, ownerUserId)),
				);
				if (savedViews.some(({ settings }) => containsLocator(settings, locator))) {
					return true;
				}
				// Kernel definitions have no plugin revision and system plugins have no owner, so both
				// resolve to a null owner and stay in scope.
				const savedViewDefinitions = yield* session.run((db) =>
					db
						.select({ settings: tables.definitionSavedView.settings })
						.from(tables.definitionSavedView)
						.leftJoin(
							tables.pluginRevision,
							eq(tables.pluginRevision.id, tables.definitionSavedView.pluginRevisionId),
						)
						.leftJoin(tables.plugin, eq(tables.plugin.id, tables.pluginRevision.pluginId))
						.where(ownedOrUnowned(tables.plugin.ownerId)),
				);
				if (savedViewDefinitions.some(({ settings }) => containsLocator(settings, locator))) {
					return true;
				}

				let afterRunId: string | undefined;
				let hasMoreRuns = true;
				while (hasMoreRuns) {
					const runs = yield* session.run((db) =>
						db
							.select({
								id: tables.automationRun.id,
								historyPayload: tables.automationRun.historyPayload,
							})
							.from(tables.automationRun)
							.innerJoin(
								tables.automationTrigger,
								eq(tables.automationTrigger.id, tables.automationRun.triggerId),
							)
							.where(
								and(
									ownedOrUnowned(tables.automationTrigger.scopeUserId),
									afterRunId === undefined ? undefined : gt(tables.automationRun.id, afterRunId),
								),
							)
							.orderBy(asc(tables.automationRun.id))
							.limit(PAGE_SIZE),
					);
					if (runs.some(({ historyPayload }) => containsLocator(historyPayload, locator))) {
						return true;
					}
					if (runs.length < PAGE_SIZE) {
						hasMoreRuns = false;
					} else {
						afterRunId = runs.at(-1)?.id;
					}
				}

				return false;
			});

			return { hasReference };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionRepository.layer),
	);
}
