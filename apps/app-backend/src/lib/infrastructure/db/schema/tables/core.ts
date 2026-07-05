import type { SandboxScriptMetadata } from "@ryot/contract/modules/sandbox/schemas";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
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

export const plugin = pgTable("plugin", {
	status: text().notNull(),
	version: text().notNull(),
	slug: text().primaryKey(),
	sourceHash: text().notNull(),
	manifest: jsonb().$type<PluginManifest>().notNull(),
	compiledHashes: jsonb().$type<Record<string, string>>().notNull(),
	ingestedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const sandboxScript = pgTable(
	"sandbox_script",
	{
		contentHash: text(),
		slug: text().notNull(),
		name: text().notNull(),
		source: text().notNull(),
		compiledCode: text().notNull(),
		isBuiltin: boolean().notNull().default(false),
		compiledFormat: smallint().notNull().default(1),
		metadata: jsonb().$type<SandboxScriptMetadata>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		pluginSlug: text().references(() => plugin.slug, { onDelete: "restrict" }),
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
		check(
			"sandbox_script_plugin_content_hash_check",
			sql`${table.pluginSlug} is null or ${table.contentHash} is not null`,
		),
		index("sandbox_script_user_id_idx").on(table.userId),
		index("sandbox_script_plugin_slug_idx").on(table.pluginSlug),
		unique("sandbox_script_user_slug_unique").on(table.userId, table.slug),
		unique("sandbox_script_plugin_slug_content_hash_unique").on(
			table.pluginSlug,
			table.slug,
			table.contentHash,
		),
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
