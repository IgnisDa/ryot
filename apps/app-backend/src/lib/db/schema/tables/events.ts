import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import type { AppSchema } from "#lib/schema/property-schema";
import type { EventTriggerMetadata } from "#modules/events/schemas";

import { user } from "../auth";
import { entitySchema, sandboxScript } from "./core";
import { entity } from "./entities";

export const eventSchema = pgTable(
	"event_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		isBuiltin: boolean().notNull().default(false),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		entitySchemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
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
		index("event_schema_entity_schema_id_idx").on(table.entitySchemaId),
		unique("event_schema_user_entity_schema_slug_unique").on(
			table.userId,
			table.entitySchemaId,
			table.slug,
		),
		uniqueIndex("event_schema_builtin_entity_schema_slug_unique")
			.on(table.entitySchemaId, table.slug)
			.where(sql`${table.userId} is null`),
	],
);

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
		eventSchemaId: text()
			.notNull()
			.references(() => eventSchema.id, { onDelete: "cascade" }),
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
		index("event_event_schema_id_idx").on(table.eventSchemaId),
		index("event_session_entity_id_idx").on(table.sessionEntityId),
		index("event_properties_idx").using("gin", table.properties),
		index("event_user_entity_schema_idx").on(table.userId, table.entityId, table.eventSchemaId),
	],
);

export const eventSchemaTrigger = pgTable(
	"event_schema_trigger",
	{
		name: text().notNull(),
		position: integer().notNull().default(1000),
		isActive: boolean().notNull().default(true),
		isBuiltin: boolean().notNull().default(false),
		phase: text().notNull().default("after_create"),
		metadata: jsonb().$type<EventTriggerMetadata>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		eventSchemaId: text()
			.notNull()
			.references(() => eventSchema.id, { onDelete: "cascade" }),
		sandboxScriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "cascade" }),
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
		index("event_schema_trigger_user_id_idx").on(table.userId),
		index("event_schema_trigger_event_schema_id_idx").on(table.eventSchemaId),
		uniqueIndex("event_schema_trigger_builtin_unique")
			.on(table.eventSchemaId, table.sandboxScriptId)
			.where(sql`${table.userId} is null`),
		unique("event_schema_trigger_user_unique").on(
			table.userId,
			table.eventSchemaId,
			table.sandboxScriptId,
		),
	],
);
