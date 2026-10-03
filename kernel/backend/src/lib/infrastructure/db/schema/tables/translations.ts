import { index, jsonb, primaryKey, snakeCase, text, timestamp } from "drizzle-orm/pg-core";

import { entity } from "./entities";

export const entityTranslation = snakeCase.table(
	"entity_translation",
	{
		name: text(),
		language: text().notNull(),
		properties: jsonb().$type<Record<string, unknown>>(),
		populatedAt: timestamp({ precision: 3, withTimezone: true }),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
		entityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ precision: 3, withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("entity_translation_entity_id_idx").on(table.entityId),
		primaryKey({ columns: [table.entityId, table.language] }),
	],
);
