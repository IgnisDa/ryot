import { generateId } from "better-auth";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { entity } from "./entities";

export const event = pgTable(
	"event",
	{
		occurredAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		eventSchemaSlug: text().notNull(),
		entityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
		sessionEntityId: text().references(() => entity.id, {
			onDelete: "cascade",
		}),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("event_user_id_idx").on(table.userId),
		index("event_entity_id_idx").on(table.entityId),
		index("event_event_schema_slug_idx").on(table.eventSchemaSlug),
		index("event_session_entity_id_idx").on(table.sessionEntityId),
		index("event_properties_idx").using("gin", table.properties),
		index("event_user_entity_schema_slugx").on(table.userId, table.entityId, table.eventSchemaSlug),
	],
);
