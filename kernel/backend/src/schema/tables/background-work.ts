import type { JsonValue } from "@ryot-app/contract/schema/json";
import { index, jsonb, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { timestamptz } from "./timestamps";

export const backgroundWork = snakeCase.table(
	"background_work",
	{
		error: text(),
		key: text().notNull(),
		scope: text().notNull(),
		id: text().primaryKey(),
		inputHash: text().notNull(),
		accountToken: text().notNull(),
		payload: jsonb().$type<JsonValue>().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		updatedAt: timestamptz().defaultNow().notNull(),
		purpose: text().$type<"user-script" | "event-projection">().notNull(),
		status: text().$type<"queued" | "failed" | "running" | "succeeded">().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("background_work_scope_idx").on(
			table.userId,
			table.pluginId,
			table.purpose,
			table.scope,
			table.createdAt,
			table.id,
		),
		index("background_work_pending_idx").on(table.status, table.updatedAt, table.id),
	],
);
