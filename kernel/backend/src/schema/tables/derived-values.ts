import type { JsonValue } from "@ryot-app/contract/schema/json";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	primaryKey,
	snakeCase,
	text,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { entity } from "./entities";
import { timestamptz } from "./timestamps";

export const derivedValue = snakeCase.table(
	"derived_value",
	{
		targetId: text().notNull(),
		pluginRevisionId: text().notNull(),
		revision: integer().notNull().default(0),
		replay: boolean().notNull().default(false),
		value: jsonb().$type<JsonValue>().notNull(),
		valueVersion: integer().notNull().default(0),
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

/** Events written since their subject's last fold, each with its image before the first change and a version every rewrite bumps. */
export const derivedChange = snakeCase.table(
	"derived_change",
	{
		eventId: text().notNull(),
		before: jsonb().$type<JsonValue>(),
		version: integer().notNull().default(0),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		subjectEntityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.subjectEntityId, table.userId, table.eventId] })],
);
