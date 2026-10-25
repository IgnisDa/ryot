import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

const eventEntityReferenceDeclarationSchema = Schema.Struct({
	eventSchemaSlug: Schema.String,
	entitySchemaSlug: Schema.String,
	paths: Schema.Array(Schema.String),
	eventSchemaPluginId: Schema.NullOr(Schema.String),
	entitySchemaPluginId: Schema.NullOr(Schema.String),
});

export type BackupEventEntityReferenceDeclaration =
	typeof eventEntityReferenceDeclarationSchema.Type;

const encodeEventReferenceDeclarations = Schema.encodeEffect(
	Schema.fromJsonString(Schema.Array(eventEntityReferenceDeclarationSchema)),
);

export class BackupExportRepository extends Context.Service<BackupExportRepository>()(
	"@ryot-app/kernel-backend/modules/backups/export/repository/BackupExportRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const listGlobalEntityIdsReferencedByUserEvents = Effect.fn(
				"BackupExportRepository.listGlobalEntityIdsReferencedByUserEvents",
			)(function* (
				userId: UserId,
				declarations: ReadonlyArray<BackupEventEntityReferenceDeclaration>,
			) {
				if (declarations.length === 0) {
					return [];
				}
				const encodedDeclarations = yield* encodeEventReferenceDeclarations(declarations).pipe(
					Effect.orDie,
				);
				const rows = yield* session.run((db) =>
					db.execute<{ id: string }>(
						sql`
						select distinct target.id
						from ${schema.event} as account_event
						inner join ${schema.entity} as event_entity
							on event_entity.id = account_event.entity_id
						inner join jsonb_to_recordset(${encodedDeclarations}::jsonb) as declaration(
							"entitySchemaSlug" text,
							"entitySchemaPluginId" text,
							"eventSchemaSlug" text,
							"eventSchemaPluginId" text,
							paths jsonb
						)
							on declaration."entitySchemaSlug" = event_entity.entity_schema_slug
							and declaration."entitySchemaPluginId" is not distinct from event_entity.entity_schema_plugin_id
							and declaration."eventSchemaSlug" = account_event.event_schema_slug
							and declaration."eventSchemaPluginId" is not distinct from account_event.event_schema_plugin_id
						cross join lateral jsonb_array_elements_text(declaration.paths) as declared_path(path)
						cross join lateral jsonb_path_query(
							account_event.properties,
							declared_path.path::jsonpath,
							'{}'::jsonb,
							true
						) as reference(value)
						inner join ${schema.entity} as target
							on target.id = (reference.value #>> '{}')
						where account_event.user_id = ${userId}
							and target.user_id is null
							and jsonb_typeof(reference.value) = 'string'
						order by target.id
					`,
						"objects",
					),
				);
				return rows.map(({ id }) => id);
			});
			const listSavedViewOverrides = Effect.fn("BackupExportRepository.listSavedViewOverrides")(
				function* (userId: UserId) {
					return yield* session.run((db) =>
						db
							.select()
							.from(schema.savedViewOverride)
							.where(eq(schema.savedViewOverride.userId, userId))
							.orderBy(asc(schema.savedViewOverride.pluginId), asc(schema.savedViewOverride.slug)),
					);
				},
			);
			const listCalendarSourceOverrides = Effect.fn(
				"BackupExportRepository.listCalendarSourceOverrides",
			)(function* (userId: UserId) {
				return yield* session.run((db) =>
					db
						.select()
						.from(schema.calendarSourceOverride)
						.where(eq(schema.calendarSourceOverride.userId, userId))
						.orderBy(
							asc(schema.calendarSourceOverride.pluginId),
							asc(schema.calendarSourceOverride.slug),
						),
				);
			});
			const listReminders = Effect.fn("BackupExportRepository.listReminders")(function* (
				userId: UserId,
			) {
				return yield* session.run((db) =>
					db
						.select()
						.from(schema.reminder)
						.where(and(eq(schema.reminder.userId, userId), isNull(schema.reminder.removedAt)))
						.orderBy(asc(schema.reminder.id)),
				);
			});
			return {
				listReminders,
				listSavedViewOverrides,
				listCalendarSourceOverrides,
				listGlobalEntityIdsReferencedByUserEvents,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
