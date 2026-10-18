import type { JsonValue } from "@ryot-app/contract/schema/json";
import { index, jsonb, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { timestamptz } from "./timestamps";

export const scriptWork = snakeCase.table(
	"script_work",
	{
		error: text(),
		key: text().notNull(),
		scope: text().notNull(),
		id: text().primaryKey(),
		inputHash: text().notNull(),
		payload: jsonb().$type<JsonValue>().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		updatedAt: timestamptz().defaultNow().notNull(),
		status: text().$type<"queued" | "running" | "succeeded" | "failed">().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("script_work_scope_idx").on(
			table.userId,
			table.pluginId,
			table.scope,
			table.createdAt,
			table.id,
		),
	],
);
