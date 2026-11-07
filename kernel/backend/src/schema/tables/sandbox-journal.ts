import { bytea, index, integer, primaryKey, snakeCase, text } from "drizzle-orm/pg-core";

import { timestamptz } from "./timestamps";

export const sandboxJournalEntry = snakeCase.table(
	"sandbox_journal_entry",
	{
		pin: text().notNull(),
		body: bytea().notNull(),
		executionId: text().notNull(),
		entryIndex: integer().notNull(),
		createdAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.executionId, table.entryIndex] }),
		index("sandbox_journal_entry_created_at_idx").on(table.createdAt),
	],
);
