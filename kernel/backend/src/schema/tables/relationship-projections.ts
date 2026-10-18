import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { relationship } from "./entities";
import { timestamptz } from "./timestamps";

export const relationshipProjectionWork = snakeCase.table(
	"relationship_projection_work",
	{
		currentJobId: text(),
		accountToken: text().notNull(),
		id: text().notNull().primaryKey(),
		pluginRevisionId: text().notNull(),
		processorScriptId: text().notNull(),
		step: integer().notNull().default(0),
		relationshipSchemaSlug: text().notNull(),
		pluginPin: jsonb().$type<JsonValue>().notNull(),
		updatedAt: timestamptz().defaultNow().notNull(),
		outputSchema: jsonb().$type<AppSchema>().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		relationshipSchemaPluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
	},
	(table) => [index("relationship_projection_work_current_job_idx").on(table.currentJobId)],
);

export const relationshipProjection = snakeCase.table(
	"relationship_projection",
	{
		projectedRevision: integer(),
		revision: integer().notNull().default(1),
		updatedAt: timestamptz().defaultNow().notNull(),
		properties: jsonb().$type<Record<string, JsonValue>>(),
		workId: text()
			.notNull()
			.references(() => relationshipProjectionWork.id, { onDelete: "cascade" }),
		relationshipId: text()
			.notNull()
			.primaryKey()
			.references(() => relationship.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("relationship_projection_dirty_idx")
			.on(table.workId, table.relationshipId)
			.where(sql`${table.projectedRevision} is distinct from ${table.revision}`),
	],
);
