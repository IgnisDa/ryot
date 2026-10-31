import type { JsonValue } from "@ryot-app/contract/schema/json";
import { index, jsonb, snakeCase, text } from "drizzle-orm/pg-core";

import { eventStream } from "./event-streams";
import { event } from "./events";
import { timestamptz } from "./timestamps";

export const eventProjection = snakeCase.table(
	"event_projection",
	{
		updatedAt: timestamptz().defaultNow().notNull(),
		properties: jsonb().$type<Record<string, JsonValue>>().notNull(),
		streamId: text()
			.notNull()
			.references(() => eventStream.id, { onDelete: "cascade" }),
		eventId: text()
			.notNull()
			.primaryKey()
			.references(() => event.id, { onDelete: "cascade" }),
	},
	(table) => [index("event_projection_stream_id_idx").on(table.streamId)],
);
