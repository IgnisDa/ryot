import type { SandboxScriptMetadata } from "@ryot/contract/modules/sandbox/schemas";
import { generateId } from "better-auth";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	smallint,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const trackerState = pgTable(
	"tracker_state",
	{
		trackerSlug: text().notNull(),
		sortOrder: integer().notNull().default(0),
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
		index("tracker_state_user_id_idx").on(table.userId),
		unique("tracker_state_user_slug_unique").on(table.userId, table.trackerSlug),
	],
);

export const sandboxScript = pgTable(
	"sandbox_script",
	{
		slug: text().notNull(),
		name: text().notNull(),
		source: text().notNull(),
		compiledCode: text().notNull(),
		isBuiltin: boolean().notNull().default(false),
		compiledFormat: smallint().notNull().default(1),
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

export const entitySchemaSandboxScript = pgTable(
	"entity_schema_sandbox_script",
	{
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		entitySchemaSlug: text().notNull(),
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
		index("entity_schema_sandbox_script_entity_schema_slug_idx").on(table.entitySchemaSlug),
		index("entity_schema_sandbox_script_sandbox_script_id_idx").on(table.sandboxScriptId),
		unique("entity_schema_sandbox_script_unique").on(table.entitySchemaSlug, table.sandboxScriptId),
	],
);
