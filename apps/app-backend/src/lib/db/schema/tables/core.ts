import type { SandboxScriptMetadata } from "@ryot/contract/modules/sandbox/schemas";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { generateId } from "better-auth";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const tracker = pgTable(
	"tracker",
	{
		description: text(),
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		accentColor: text().notNull(),
		sortOrder: integer().notNull().default(0),
		isBuiltin: boolean().notNull().default(false),
		isDisabled: boolean().notNull().default(false),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
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
		index("tracker_user_id_idx").on(table.userId),
		unique("tracker_user_slug_unique").on(table.userId, table.slug),
	],
);

export const entitySchema = pgTable(
	"entity_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		accentColor: text().notNull(),
		isBuiltin: boolean().notNull().default(false),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
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
		index("entity_schema_user_id_idx").on(table.userId),
		unique("entity_schema_user_slug_unique").on(table.userId, table.slug),
	],
);

export const trackerEntitySchema = pgTable(
	"tracker_entity_schema",
	{
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		trackerId: text()
			.notNull()
			.references(() => tracker.id, { onDelete: "cascade" }),
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
		index("tracker_entity_schema_tracker_id_idx").on(table.trackerId),
		index("tracker_entity_schema_entity_schema_id_idx").on(table.entitySchemaId),
		unique("tracker_entity_schema_unique").on(table.trackerId, table.entitySchemaId),
	],
);

export const sandboxScript = pgTable(
	"sandbox_script",
	{
		slug: text().notNull(),
		name: text().notNull(),
		code: text().notNull(),
		isBuiltin: boolean().notNull().default(false),
		metadata: jsonb().$type<SandboxScriptMetadata>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
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
		index("sandbox_script_user_id_idx").on(table.userId),
		unique("sandbox_script_user_slug_unique").on(table.userId, table.slug),
	],
);

export const entitySchemaScript = pgTable(
	"entity_schema_script",
	{
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		entitySchemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
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
		index("entity_schema_script_entity_schema_id_idx").on(table.entitySchemaId),
		index("entity_schema_script_sandbox_script_id_idx").on(table.sandboxScriptId),
		unique("entity_schema_script_unique").on(table.entitySchemaId, table.sandboxScriptId),
	],
);
