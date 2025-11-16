import { generateId } from "better-auth";
import { index, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import type { StoredEntityImage } from "#modules/entities/types";

import { entity } from "./entities";

export const entityTranslation = pgTable(
	"entity_translation",
	{
		name: text(),
		language: text().notNull(),
		image: jsonb().$type<StoredEntityImage>(),
		properties: jsonb().$type<Record<string, unknown>>(),
		populatedAt: timestamp({ withTimezone: true }),
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
