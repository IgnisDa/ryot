import type { JsonValue } from "@ryot-app/contract/schema/json";
import { sql } from "drizzle-orm";
import { check, index, integer, json, snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamptz } from "./timestamps";

export const job = snakeCase.table(
	"job",
	{
		key: text(),
		error: text(),
		kind: text().notNull(),
		id: text().primaryKey(),
		lockedUntil: timestamptz(),
		attempts: integer().notNull(),
		priority: integer().notNull(),
		maxAttempts: integer().notNull(),
		runAt: timestamptz().defaultNow().notNull(),
		// Not jsonb, which refuses the NUL escapes a raw webhook body in a script input may hold.
		payload: json().$type<JsonValue>().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		updatedAt: timestamptz().defaultNow().notNull(),
		status: text().$type<"failed" | "queued" | "running">().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("job_queued_key_unique")
			.on(table.kind, table.key)
			.where(sql`${table.status} = 'queued' and ${table.key} is not null`),
		index("job_claim_idx")
			.on(table.kind, table.priority, table.runAt, table.id)
			.where(sql`${table.status} = 'queued'`),
		index("job_running_idx")
			.on(table.lockedUntil)
			.where(sql`${table.status} = 'running'`),
		index("job_failed_idx")
			.on(table.updatedAt)
			.where(sql`${table.status} = 'failed'`),
		check("job_status_check", sql`${table.status} in ('queued', 'running', 'failed')`),
	],
);
