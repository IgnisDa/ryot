import { index, integer, jsonb, primaryKey, snakeCase, text } from "drizzle-orm/pg-core";

import { entity } from "./entities";
import { timestamptz, updatedAtColumn } from "./timestamps";

export const entityTranslation = snakeCase.table(
	"entity_translation",
	{
		name: text(),
		language: text().notNull(),
		populatedAt: timestamptz(),
		updatedAt: updatedAtColumn(),
		sourceContentGeneration: integer().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		properties: jsonb().$type<Record<string, unknown>>(),
		entityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("entity_translation_entity_id_idx").on(table.entityId),
		primaryKey({ columns: [table.entityId, table.language] }),
	],
);
