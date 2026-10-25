import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { index, integer, jsonb, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { entity } from "./entities";
import { timestamptz } from "./timestamps";

export const eventStream = snakeCase.table("event_stream", {
	id: text().notNull().primaryKey(),
	eventSchemaSlug: text().notNull(),
	revision: integer().notNull().default(0),
	updatedAt: timestamptz().defaultNow().notNull(),
	eventSchemaPluginId: text().references(() => plugin.id, { onDelete: "cascade" }),
	userId: text()
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	entityId: text()
		.notNull()
		.references(() => entity.id, { onDelete: "cascade" }),
});

export const eventStreamWork = snakeCase.table(
	"event_stream_work",
	{
		currentJobId: text(),
		dirtyFrom: timestamptz(),
		completedRevision: integer(),
		accountToken: text().notNull(),
		pluginRevisionId: text().notNull(),
		processorScriptId: text().notNull(),
		step: integer().notNull().default(0),
		pluginPin: jsonb().$type<JsonValue>().notNull(),
		updatedAt: timestamptz().defaultNow().notNull(),
		outputSchema: jsonb().$type<AppSchema>().notNull(),
		checkpoint: jsonb().$type<JsonValue>().default(null),
		id: text()
			.notNull()
			.primaryKey()
			.references(() => eventStream.id, { onDelete: "cascade" }),
	},
	(table) => [index("event_stream_work_current_job_idx").on(table.currentJobId)],
);
