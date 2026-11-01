import {
	eventStreamId,
	StreamKeySchema,
} from "@ryot-app/kernel-backend/modules/events/stream-repository";
import { Effect, Schema } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

const batchSize = 500;

const SeededStream = Schema.Struct({ ...StreamKeySchema.fields, id: Schema.String });

const decodeStreamKeys = Schema.decodeUnknownEffect(Schema.Array(StreamKeySchema));

const streamKeysSql = (hasCursor: boolean) => `
SELECT ev."user_id" AS "userId", ev."entity_id" AS "entityId",
	ev."event_schema_slug" AS "eventSchemaSlug", ev."event_schema_plugin_id" AS "eventSchemaPluginId"
FROM "event" ev
${
	hasCursor
		? `WHERE (ev."user_id", ev."entity_id", ev."event_schema_slug") >= ($1, $2, $3)
	AND (ev."user_id", ev."entity_id", ev."event_schema_slug", coalesce(ev."event_schema_plugin_id", '')) > ($1, $2, $3, $4)`
		: ""
}
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, coalesce(ev."event_schema_plugin_id", '')
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

export const seedEventStreams = Effect.fn("seedEventStreams")(function* (
	connection: SqlConnection.Connection,
) {
	let cursor: undefined | typeof StreamKeySchema.Type;
	for (;;) {
		const rows = yield* connection.execute(
			streamKeysSql(cursor !== undefined),
			cursor === undefined
				? []
				: [
						cursor.userId,
						cursor.entityId,
						cursor.eventSchemaSlug,
						cursor.eventSchemaPluginId ?? "",
					],
			undefined,
		);
		const keys = yield* decodeStreamKeys(rows).pipe(Effect.orDie);
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
