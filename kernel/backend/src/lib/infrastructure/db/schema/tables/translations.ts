import { generateId } from "better-auth";
import { index, jsonb, snakeCase, text, timestamp, unique } from "drizzle-orm/pg-core";

import { entity } from "./entities";

export const entityTranslation = snakeCase.table(
	"entity_translation",
	{
		name: text(),
		language: text().notNull(),
		populatedAt: timestamp({ withTimezone: true }),
		properties: jsonb().$type<Record<string, unknown>>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		entityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("entity_translation_entity_id_idx").on(table.entityId),
		unique("entity_translation_entity_language_unique").on(table.entityId, table.language),
	],
);
