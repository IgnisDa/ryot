import type {
	ProviderInformation,
	SandboxScriptMetadata,
} from "@ryot/contract/modules/sandbox/schemas";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
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
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const pluginState = pgTable(
	"plugin_state",
	{
		pluginSlug: text().notNull(),
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
		index("plugin_state_user_id_idx").on(table.userId),
		unique("plugin_state_user_slug_unique").on(table.userId, table.pluginSlug),
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

export const sandboxProvider = pgTable(
	"sandbox_provider",
	{
		slug: text().notNull(),
		name: text().notNull(),
		information: jsonb().$type<ProviderInformation>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		pluginSlug: text()
			.notNull()
			.references(() => plugin.slug, { onDelete: "restrict" }),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		index("sandbox_provider_plugin_slug_idx").on(table.pluginSlug),
		unique("sandbox_provider_plugin_slug_unique").on(table.pluginSlug, table.slug),
	],
);

export const sandboxScript = pgTable(
	"sandbox_script",
	{
		slug: text().notNull(),
		name: text().notNull(),
		source: text().notNull(),
		contentHash: text().notNull(),
		compiledCode: text().notNull(),
		compiledFormat: smallint().notNull().default(1),
		metadata: jsonb().$type<SandboxScriptMetadata>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		pluginSlug: text().references(() => plugin.slug, { onDelete: "restrict" }),
		providerId: text().references(() => sandboxProvider.id, { onDelete: "cascade" }),
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
		index("sandbox_script_provider_id_idx").on(table.providerId),
		index("sandbox_script_plugin_slug_idx").on(table.pluginSlug),
		unique("sandbox_script_plugin_slug_content_hash_unique").on(
			table.pluginSlug,
			table.slug,
			table.contentHash,
		),
		uniqueIndex("sandbox_script_kernel_slug_content_hash_unique")
			.on(table.slug, table.contentHash)
			.where(sql`${table.pluginSlug} is null`),
	],
);

export const sandboxWorkflowReference = pgTable(
	"sandbox_workflow_reference",
	{
		contentHash: text().notNull(),
		executionId: text().primaryKey(),
		pluginSlug: text()
			.notNull()
			.references(() => plugin.slug, { onDelete: "restrict" }),
		scriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "restrict" }),
	},
	(table) => [
		index("sandbox_workflow_reference_plugin_slug_idx").on(table.pluginSlug),
		index("sandbox_workflow_reference_script_id_idx").on(table.scriptId),
	],
);
