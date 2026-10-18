import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, type Column, eq, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

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

const encodeLocatorKeys = Schema.encodeEffect(
	Schema.fromJsonString(Schema.Struct({ keys: Schema.Array(Schema.String) })),
);

const locatorObjectsPath =
	'strict $.** ? (@.type() == "object" && @."type".type() == "string" && @."key".type() == "string" && @."key" == $keys[*])';

export class ManagedAssetReferencesRepository extends Context.Service<ManagedAssetReferencesRepository>()(
	"ManagedAssetReferencesRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;

			// Encrypted plugin configuration cannot be inspected, so an asset-capable schema retains
			// every asset its owner (or any owner, for unowned revisions) may have stored there.
			const hasOpaqueConfigReference = Effect.fn(
				"ManagedAssetReferencesRepository.hasOpaqueConfigReference",
			)(function* (ownerUserId: UserId) {
				const found = { found: sql`true` };
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
								isNotNull(tables.pluginInstallation.activeConfigRevisionId),
								or(
									isNull(tables.pluginRevision.configSchema),
									eq(tables.pluginRevision.configSchema, sql`'null'::jsonb`),
									schemaHasAssets(tables.pluginRevision.configSchema),
								),
							),
						)
						.limit(1),
				);
				if (installations.length > 0) {
					return true;
				}
				const revisions = yield* session.run((db) =>
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
								or(
									eq(tables.pluginConfigRevision.ownerUserId, ownerUserId),
									isNull(tables.pluginConfigRevision.ownerUserId),
								),
								schemaHasAssets(tables.pluginRevision.configSchema),
							),
						)
						.limit(1),
				);
				return revisions.length > 0;
			});

			const referencedLocators = Effect.fn("ManagedAssetReferencesRepository.referencedLocators")(
				function* (ownerUserId: UserId, locators: ReadonlyArray<ManagedAssetLocator>) {
					if (locators.length === 0) {
						return [];
					}
					if (yield* hasOpaqueConfigReference(ownerUserId)) {
						return locators;
					}
					const vars = yield* encodeLocatorKeys({
						keys: [...new Set(locators.map(({ key }) => key))],
					}).pipe(Effect.orDie);
					const owned = (column: Column) => sql`${column} = ${ownerUserId}`;
					const ownedOrUnowned = (column: Column) =>
						sql`(${column} = ${ownerUserId} or ${column} is null)`;
					const scan = (from: SQL, column: Column, where: SQL) => sql`
						select found.value->>'type' as type, found.value->>'key' as key
						from ${from}
						cross join lateral jsonb_path_query(${column}, ${locatorObjectsPath}::jsonpath, ${vars}::jsonb, true) as found(value)
						where ${where}`;
					const scans = [
						scan(
							sql`${tables.entity}`,
							tables.entity.properties,
							ownedOrUnowned(tables.entity.userId),
						),
						scan(
							sql`${tables.entityTranslation} inner join ${tables.entity} on ${tables.entity.id} = ${tables.entityTranslation.entityId}`,
							tables.entityTranslation.properties,
							ownedOrUnowned(tables.entity.userId),
						),
						scan(
							sql`${tables.relationship}`,
							tables.relationship.properties,
							ownedOrUnowned(tables.relationship.userId),
						),
						scan(sql`${tables.event}`, tables.event.properties, owned(tables.event.userId)),
						scan(
							sql`${tables.eventProjection} inner join ${tables.event} on ${tables.event.id} = ${tables.eventProjection.eventId}`,
							tables.eventProjection.properties,
							owned(tables.event.userId),
						),
						scan(
							sql`${tables.relationshipProjection} inner join ${tables.relationshipProjectionWork} on ${tables.relationshipProjectionWork.id} = ${tables.relationshipProjection.workId}`,
							tables.relationshipProjection.properties,
							owned(tables.relationshipProjectionWork.userId),
						),
						scan(
							sql`${tables.pluginInstallation}`,
							tables.pluginInstallation.clientConfig,
							owned(tables.pluginInstallation.userId),
						),
						scan(
							sql`${tables.pluginInstallation}`,
							tables.pluginInstallation.userSettings,
							owned(tables.pluginInstallation.userId),
						),
						scan(
							sql`${tables.integration}`,
							tables.integration.providerSpecifics,
							owned(tables.integration.userId),
						),
						scan(
							sql`${tables.notificationSubscription}`,
							tables.notificationSubscription.metadata,
							owned(tables.notificationSubscription.userId),
						),
						scan(
							sql`${tables.automationTrigger}`,
							tables.automationTrigger.payload,
							ownedOrUnowned(tables.automationTrigger.scopeUserId),
						),
						scan(
							sql`${tables.savedView}`,
							tables.savedView.settings,
							owned(tables.savedView.userId),
						),
						// Kernel definitions have no plugin revision and system plugins have no owner, so both
						// resolve to a null owner and stay in scope.
						scan(
							sql`${tables.definitionSavedView} left join ${tables.pluginRevision} on ${tables.pluginRevision.id} = ${tables.definitionSavedView.pluginRevisionId} left join ${tables.plugin} on ${tables.plugin.id} = ${tables.pluginRevision.pluginId}`,
							tables.definitionSavedView.settings,
							ownedOrUnowned(tables.plugin.ownerId),
						),
						scan(
							sql`${tables.automationRun} inner join ${tables.automationTrigger} on ${tables.automationTrigger.id} = ${tables.automationRun.triggerId}`,
							tables.automationRun.historyPayload,
							ownedOrUnowned(tables.automationTrigger.scopeUserId),
						),
					];
					const rows = yield* session.run((db) =>
						db.execute<{ key: string; type: string }>(sql.join(scans, sql` union `), "objects"),
					);
					const found = new Set(rows.map(({ key, type }) => `${type}\0${key}`));
					return locators.filter(({ key, type }) => found.has(`${type}\0${key}`));
				},
			);

			return { referencedLocators };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
