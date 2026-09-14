import { generateId } from "better-auth";
import { index, jsonb, snakeCase, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { entity } from "./entities";

export const event = snakeCase.table(
	"event",
	{
		eventSchemaSlug: text().notNull(),
		occurredAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		sessionEntityId: text().references(() => entity.id, { onDelete: "cascade" }),
		eventSchemaPluginId: text().references(() => plugin.id, { onDelete: "restrict" }),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
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
		index("event_user_id_idx").on(table.userId),
		index("event_entity_id_idx").on(table.entityId),
		index("event_event_schema_slug_idx").on(table.eventSchemaSlug),
		index("event_event_schema_plugin_id_idx").on(table.eventSchemaPluginId),
		index("event_session_entity_id_idx").on(table.sessionEntityId),
		index("event_properties_idx").using("gin", table.properties),
		index("event_user_entity_schema_order_idx").on(
			table.userId,
			table.entityId,
			table.eventSchemaSlug,
			table.occurredAt.desc(),
			table.createdAt.desc(),
			table.id.desc(),
		),
		index("event_user_session_order_idx").on(
			table.userId,
			table.sessionEntityId,
			table.occurredAt.desc(),
			table.createdAt.desc(),
			table.id.desc(),
		),
	],
);
