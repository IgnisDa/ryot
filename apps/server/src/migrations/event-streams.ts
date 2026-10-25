import {
	eventStreamId,
	StreamKeySchema,
} from "@ryot-app/kernel-backend/modules/events/stream-repository";
import { Effect, Schema } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

const batchSize = 500;

const SeededStream = Schema.Struct({ ...StreamKeySchema.fields, id: Schema.String });

const projectedStreamKeysSql = (hasCursor: boolean) => `
SELECT DISTINCT ev."user_id" AS "userId", ev."entity_id" AS "entityId",
	ev."event_schema_slug" AS "eventSchemaSlug", ev."event_schema_plugin_id" AS "eventSchemaPluginId"
FROM "event" ev
JOIN "entity" en ON en."id" = ev."entity_id"
JOIN "plugin" p ON p."id" = ev."event_schema_plugin_id"
JOIN "definition_entity_schema" es ON es."plugin_revision_id" = p."active_revision_id"
	AND es."slug" = en."entity_schema_slug"
JOIN "definition_event_schema" ds ON ds."entity_schema_id" = es."id"
	AND ds."slug" = ev."event_schema_slug" AND ds."projection" IS NOT NULL
${hasCursor ? 'WHERE (ev."user_id", ev."entity_id", ev."event_schema_plugin_id", ev."event_schema_slug") > ($1, $2, $3, $4)' : ""}
ORDER BY 1, 2, 4, 3
LIMIT ${batchSize}
`;

const insertStreamsSql = `
INSERT INTO "event_stream" ("id", "user_id", "entity_id", "event_schema_slug", "event_schema_plugin_id")
SELECT stream."id", stream."userId", stream."entityId", stream."eventSchemaSlug", stream."eventSchemaPluginId"
FROM jsonb_to_recordset($1::jsonb) AS stream(
	"id" text, "userId" text, "entityId" text, "eventSchemaSlug" text, "eventSchemaPluginId" text
)
ON CONFLICT DO NOTHING
`;

export const seedProjectedEventStreams = Effect.fn("seedProjectedEventStreams")(function* (
	connection: SqlConnection.Connection,
) {
	let cursor: undefined | typeof StreamKeySchema.Type;
	for (;;) {
		const rows = yield* connection.execute(
			projectedStreamKeysSql(cursor !== undefined),
			cursor === undefined
				? []
				: [cursor.userId, cursor.entityId, cursor.eventSchemaPluginId, cursor.eventSchemaSlug],
			undefined,
		);
		const keys = yield* Schema.decodeEffect(Schema.Array(StreamKeySchema))(rows).pipe(Effect.orDie);
		if (keys.length === 0) {
			return;
		}
		const streams = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(SeededStream)))(
			keys.map((key) => ({ ...key, id: eventStreamId(key) })),
		).pipe(Effect.orDie);
		yield* connection.execute(insertStreamsSql, [streams], undefined);
		cursor = keys[keys.length - 1];
		if (keys.length < batchSize) {
			return;
		}
	}
});
