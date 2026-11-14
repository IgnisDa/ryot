import type { JsonValue } from "@ryot-app/contract/schema/json";
import { sql } from "drizzle-orm";
import { check, index, jsonb, primaryKey, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { entity } from "./entities";
import { timestamptz } from "./timestamps";

export const derivedValue = snakeCase.table(
	"derived_value",
	{
		targetId: text().notNull(),
		pluginRevisionId: text().notNull(),
		value: jsonb().$type<JsonValue>().notNull(),
		updatedAt: timestamptz().defaultNow().notNull(),
		kind: text().$type<"event" | "subject" | "absorbed" | "relationship">().notNull(),
		status: text().$type<"ready" | "failed" | "pending">().notNull().default("ready"),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
		subjectEntityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.kind, table.targetId] }),
		index("derived_value_subject_idx").on(table.subjectEntityId, table.userId),
		check(
			"derived_value_kind_check",
			sql`${table.kind} in ('subject', 'event', 'relationship', 'absorbed')`,
		),
		check("derived_value_status_check", sql`${table.status} in ('ready', 'pending', 'failed')`),
	],
);
