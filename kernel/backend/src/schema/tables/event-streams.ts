import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, primaryKey, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { entity } from "./entities";
import { timestamptz } from "./timestamps";

export const eventStream = snakeCase.table(
	"event_stream",
	{
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
	},
	(table) => [
		index("event_stream_key_idx").on(
			table.entityId,
			table.userId,
			table.eventSchemaPluginId,
			table.eventSchemaSlug,
		),
		index("event_stream_user_schema_idx").on(
			table.userId,
			table.eventSchemaPluginId,
			table.eventSchemaSlug,
		),
	],
);

export const eventStreamWork = snakeCase.table(
	"event_stream_work",
	{
		currentJobId: text(),
		userId: text().notNull(),
		dirtyFrom: timestamptz(),
		completedRevision: integer(),
		accountToken: text().notNull(),
		eventSchemaSlug: text().notNull(),
		pluginRevisionId: text().notNull(),
		processorScriptId: text().notNull(),
		eventSchemaPluginId: text().notNull(),
		pluginPin: jsonb().$type<JsonValue>().notNull(),
		updatedAt: timestamptz().defaultNow().notNull(),
		claimedAlone: boolean().notNull().default(false),
		outputSchema: jsonb().$type<AppSchema>().notNull(),
		checkpoint: jsonb().$type<JsonValue>().default(null),
		configRevisionId: text().generatedAlwaysAs(sql`plugin_pin ->> 'configRevisionId'`),
		id: text()
			.notNull()
			.primaryKey()
			.references(() => eventStream.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("event_stream_work_current_job_idx").on(table.currentJobId),
		index("event_stream_work_dirty_idx")
			.on(table.userId, table.eventSchemaPluginId, table.eventSchemaSlug, table.id)
			.where(sql`${table.completedRevision} is null or ${table.dirtyFrom} is not null`),
	],
);

export const eventStreamBinding = snakeCase.table(
	"event_stream_binding",
	{
		accountToken: text(),
		boundRevision: integer(),
		configRevisionId: text(),
		pluginRevisionId: text(),
		eventSchemaSlug: text().notNull(),
		entitySchemaSlug: text().notNull(),
		revision: integer().notNull().default(0),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		eventSchemaPluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({
			columns: [
				table.userId,
				table.eventSchemaPluginId,
				table.entitySchemaSlug,
				table.eventSchemaSlug,
			],
		}),
	],
);
