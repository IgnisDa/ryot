import type { JsonValue } from "@ryot-app/contract/schema/json";
import { index, jsonb, primaryKey, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamptz } from "./timestamps";

export const idempotencyKey = snakeCase.table(
	"idempotency_key",
	{
		key: text().notNull(),
		fingerprint: text().notNull(),
		response: jsonb().$type<JsonValue>(),
		createdAt: timestamptz().defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.key] }),
		index("idempotency_key_created_at_idx").on(table.createdAt),
	],
);
