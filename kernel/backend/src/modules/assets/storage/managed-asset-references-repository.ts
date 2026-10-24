import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, type Column, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

const schemaHasAssets = (column: Column) => sql`exists (
	with recursive properties(value) as (
		select value from jsonb_each(
			case when jsonb_typeof(${column}->'fields') = 'object'
				then ${column}->'fields' else '{}'::jsonb end
		)
		union all
		select child.value from properties
		cross join lateral jsonb_each(
			case
				when properties.value->>'type' = 'object'
					and jsonb_typeof(properties.value->'properties') = 'object'
					then properties.value->'properties'
				when properties.value->>'type' = 'array'
					then jsonb_build_object('items', properties.value->'items')
				else '{}'::jsonb
			end
		) child
	)
	select 1 from properties
	where value->>'type' = 'object' and value->'validation'->'asset' = 'true'::jsonb
)`;

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
				const containsLocator = (column: Column) => sql`jsonb_path_exists(
					${column},
					'strict $.** ? (@.type() == "object" && @."type".type() == "string" && @."key".type() == "string" && @."type" == $provider && @."key" == $key)',
					${JSON.stringify({ key: locator.key, provider: locator.type })}::jsonb,
					true
				)`;
				const found = { found: sql`true` };

				const entities = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.entity)
						.where(
							and(ownedOrUnowned(tables.entity.userId), containsLocator(tables.entity.properties)),
						)
						.limit(1),
				);
				if (entities.length > 0) {
					return true;
				}

				const translations = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.entityTranslation)
						.innerJoin(tables.entity, eq(tables.entity.id, tables.entityTranslation.entityId))
						.where(
							and(
								ownedOrUnowned(tables.entity.userId),
								containsLocator(tables.entityTranslation.properties),
							),
						)
						.limit(1),
				);
				if (translations.length > 0) {
					return true;
				}

				const relationships = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.relationship)
						.where(
							and(
								ownedOrUnowned(tables.relationship.userId),
								containsLocator(tables.relationship.properties),
							),
						)
						.limit(1),
				);
				if (relationships.length > 0) {
					return true;
				}

				const events = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.event)
						.where(
							and(eq(tables.event.userId, ownerUserId), containsLocator(tables.event.properties)),
						)
						.limit(1),
				);
				if (events.length > 0) {
					return true;
				}

				const projections = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.eventProjection)
						.innerJoin(tables.event, eq(tables.event.id, tables.eventProjection.eventId))
						.where(
							and(
								eq(tables.event.userId, ownerUserId),
								containsLocator(tables.eventProjection.properties),
							),
						)
						.limit(1),
				);
				if (projections.length > 0) {
					return true;
				}

				const installations = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.pluginInstallation)
						.innerJoin(tables.plugin, eq(tables.plugin.id, tables.pluginInstallation.pluginId))
						.leftJoin(
							tables.pluginRevision,
							eq(tables.pluginRevision.id, tables.plugin.activeRevisionId),
						)
						.where(
							and(
								eq(tables.pluginInstallation.userId, ownerUserId),
								or(
									containsLocator(tables.pluginInstallation.clientConfig),
									containsLocator(tables.pluginInstallation.userSettings),
									and(
										isNotNull(tables.pluginInstallation.activeConfigRevisionId),
										or(
											isNull(tables.pluginRevision.configSchema),
											eq(tables.pluginRevision.configSchema, sql`'null'::jsonb`),
											schemaHasAssets(tables.pluginRevision.configSchema),
										),
									),
								),
							),
						)
						.limit(1),
				);
				if (installations.length > 0) {
					return true;
				}

				const archivedConfigs = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.pluginConfigRevision)
						.innerJoin(
							tables.pluginRevision,
							eq(tables.pluginRevision.id, tables.pluginConfigRevision.pluginRevisionId),
						)
						.where(
							and(
								isNotNull(tables.pluginConfigRevision.encryptedPayload),
								ownedOrUnowned(tables.pluginConfigRevision.ownerUserId),
								schemaHasAssets(tables.pluginRevision.configSchema),
							),
						)
						.limit(1),
				);
				if (archivedConfigs.length > 0) {
					return true;
				}

				const integrations = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.integration)
						.where(
							and(
								eq(tables.integration.userId, ownerUserId),
								containsLocator(tables.integration.providerSpecifics),
							),
						)
						.limit(1),
				);
				if (integrations.length > 0) {
					return true;
				}

				const subscriptions = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.notificationSubscription)
						.where(
							and(
								eq(tables.notificationSubscription.userId, ownerUserId),
								containsLocator(tables.notificationSubscription.metadata),
							),
						)
						.limit(1),
				);
				if (subscriptions.length > 0) {
					return true;
				}

				const triggers = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.automationTrigger)
						.where(
							and(
								ownedOrUnowned(tables.automationTrigger.scopeUserId),
								containsLocator(tables.automationTrigger.payload),
							),
						)
						.limit(1),
				);
				if (triggers.length > 0) {
					return true;
				}

				const savedViews = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.savedView)
						.where(
							and(
								eq(tables.savedView.userId, ownerUserId),
								containsLocator(tables.savedView.settings),
							),
						)
						.limit(1),
				);
				if (savedViews.length > 0) {
					return true;
				}

				const savedViewDefinitions = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.definitionSavedView)
						.leftJoin(
							tables.pluginRevision,
							eq(tables.pluginRevision.id, tables.definitionSavedView.pluginRevisionId),
						)
						.leftJoin(tables.plugin, eq(tables.plugin.id, tables.pluginRevision.pluginId))
						.where(
							and(
								ownedOrUnowned(tables.plugin.ownerId),
								containsLocator(tables.definitionSavedView.settings),
							),
						)
						.limit(1),
				);
				if (savedViewDefinitions.length > 0) {
					return true;
				}

				const runs = yield* session.run((db) =>
					db
						.select(found)
						.from(tables.automationRun)
						.innerJoin(
							tables.automationTrigger,
							eq(tables.automationTrigger.id, tables.automationRun.triggerId),
						)
						.where(
							and(
								ownedOrUnowned(tables.automationTrigger.scopeUserId),
								containsLocator(tables.automationRun.historyPayload),
							),
						)
						.limit(1),
				);
				return runs.length > 0;
			});

			return { hasReference };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
