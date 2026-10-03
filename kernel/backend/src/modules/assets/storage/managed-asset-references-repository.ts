import type { DbError } from "@ryot-app/contract/errors";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { and, asc, type Column, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

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

type PageRow = { readonly id: string; readonly value: unknown };

const pagesContainLocator = Effect.fnUntraced(function* (
	locator: ManagedAssetLocator,
	page: (afterId: string | undefined) => Effect.Effect<ReadonlyArray<PageRow>, DbError>,
) {
	let afterId: string | undefined;
	let rows: ReadonlyArray<PageRow>;
	do {
		rows = yield* page(afterId);
		if (rows.some(({ value }) => containsLocator(value, locator))) {
			return true;
		}
		afterId = rows.at(-1)?.id;
	} while (rows.length === PAGE_SIZE);
	return false;
});

const after = (column: Column, afterId: string | undefined) =>
	afterId === undefined ? undefined : gt(column, afterId);

export class ManagedAssetReferencesRepository extends Context.Service<ManagedAssetReferencesRepository>()(
	"ManagedAssetReferencesRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;

			const hasReference = Effect.fn("ManagedAssetReferencesRepository.hasReference")(function* (
				ownerUserId: UserId,
				locator: ManagedAssetLocator,
			) {
				const ownedOrUnowned = (column: Column) => or(eq(column, ownerUserId), isNull(column));
				const anyContainsLocator = (values: ReadonlyArray<unknown>) =>
					values.some((value) => containsLocator(value, locator));

				const entitiesReference = yield* pagesContainLocator(locator, (afterId) =>
					session.run((db) =>
						db
							.select({ id: tables.entity.id, value: tables.entity.properties })
							.from(tables.entity)
							.where(and(ownedOrUnowned(tables.entity.userId), after(tables.entity.id, afterId)))
							.orderBy(asc(tables.entity.id))
							.limit(PAGE_SIZE),
					),
				);
				if (entitiesReference) {
					return true;
				}

				const translations = yield* session.run((db) =>
					db
						.select({ properties: tables.entityTranslation.properties })
						.from(tables.entityTranslation)
						.innerJoin(tables.entity, eq(tables.entity.id, tables.entityTranslation.entityId))
						.where(ownedOrUnowned(tables.entity.userId)),
				);
				if (anyContainsLocator(translations.map(({ properties }) => properties))) {
					return true;
				}

				const relationships = yield* session.run((db) =>
					db
						.select({ properties: tables.relationship.properties })
						.from(tables.relationship)
						.where(ownedOrUnowned(tables.relationship.userId)),
				);
				if (anyContainsLocator(relationships.map(({ properties }) => properties))) {
					return true;
				}

				const eventsReference = yield* pagesContainLocator(locator, (afterId) =>
					session.run((db) =>
						db
							.select({ id: tables.event.id, value: tables.event.properties })
							.from(tables.event)
							.where(and(eq(tables.event.userId, ownerUserId), after(tables.event.id, afterId)))
							.orderBy(asc(tables.event.id))
							.limit(PAGE_SIZE),
					),
				);
				if (eventsReference) {
					return true;
				}

				const installations = yield* session.run((db) =>
					db
						.select({
							configSchema: tables.pluginRevision.configSchema,
							clientConfig: tables.pluginInstallation.clientConfig,
							userSettings: tables.pluginInstallation.userSettings,
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
					if (anyContainsLocator([installation.clientConfig, installation.userSettings])) {
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
						.select({ providerSpecifics: tables.integration.providerSpecifics })
						.from(tables.integration)
						.where(eq(tables.integration.userId, ownerUserId)),
				);
				if (anyContainsLocator(integrations.map(({ providerSpecifics }) => providerSpecifics))) {
					return true;
				}

				const subscriptions = yield* session.run((db) =>
					db
						.select({ metadata: tables.notificationSubscription.metadata })
						.from(tables.notificationSubscription)
						.where(eq(tables.notificationSubscription.userId, ownerUserId)),
				);
				if (anyContainsLocator(subscriptions.map(({ metadata }) => metadata))) {
					return true;
				}

				const triggersReference = yield* pagesContainLocator(locator, (afterId) =>
					session.run((db) =>
						db
							.select({ id: tables.automationTrigger.id, value: tables.automationTrigger.payload })
							.from(tables.automationTrigger)
							.where(
								and(
									ownedOrUnowned(tables.automationTrigger.scopeUserId),
									after(tables.automationTrigger.id, afterId),
								),
							)
							.orderBy(asc(tables.automationTrigger.id))
							.limit(PAGE_SIZE),
					),
				);
				if (triggersReference) {
					return true;
				}

				const savedViews = yield* session.run((db) =>
					db
						.select({ settings: tables.savedView.settings })
						.from(tables.savedView)
						.where(eq(tables.savedView.userId, ownerUserId)),
				);
				if (anyContainsLocator(savedViews.map(({ settings }) => settings))) {
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
				if (anyContainsLocator(savedViewDefinitions.map(({ settings }) => settings))) {
					return true;
				}

				return yield* pagesContainLocator(locator, (afterId) =>
					session.run((db) =>
						db
							.select({ id: tables.automationRun.id, value: tables.automationRun.historyPayload })
							.from(tables.automationRun)
							.innerJoin(
								tables.automationTrigger,
								eq(tables.automationTrigger.id, tables.automationRun.triggerId),
							)
							.where(
								and(
									ownedOrUnowned(tables.automationTrigger.scopeUserId),
									after(tables.automationRun.id, afterId),
								),
							)
							.orderBy(asc(tables.automationRun.id))
							.limit(PAGE_SIZE),
					),
				);
			});

			return { hasReference };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
