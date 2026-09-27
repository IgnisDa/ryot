import type { JsonValue } from "@ryot-app/contract/schema/json";
import { sql } from "drizzle-orm";
import { check, integer, jsonb, snakeCase, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { entity } from "./entities";

export const eventStream = snakeCase.table("event_stream", {
	id: text().notNull().primaryKey(),
	eventSchemaSlug: text().notNull(),
	revision: integer().notNull().default(0),
	updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
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
		error: text(),
		claimedRevision: integer(),
		accountToken: text().notNull(),
		pluginRevisionId: text().notNull(),
		processorScriptId: text().notNull(),
		attempt: integer().notNull().default(0),
		dirtyFrom: timestamp({ withTimezone: true }),
		pluginPin: jsonb().$type<JsonValue>().notNull(),
		checkpoint: jsonb().$type<JsonValue>().default(null),
		updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		outputProperties: jsonb().$type<ReadonlyArray<string>>().notNull().default([]),
		id: text()
			.notNull()
			.primaryKey()
			.references(() => eventStream.id, { onDelete: "cascade" }),
		status: text()
			.$type<"queued" | "running" | "completed" | "failed">()
			.notNull()
			.default("queued"),
	},
	(table) => [
		check(
			"event_stream_work_status_check",
			sql`${table.status} in ('queued', 'running', 'completed', 'failed')`,
		),
		check("event_stream_work_attempt_check", sql`${table.attempt} >= 0`),
	],
);
