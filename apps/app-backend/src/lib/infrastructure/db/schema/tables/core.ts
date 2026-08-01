import type {
	PluginManifest,
	PluginProviderOperation,
} from "@ryot/contract/modules/plugins/manifest";
import type {
	ProviderInformation,
	SandboxScriptMetadata,
} from "@ryot/contract/modules/sandbox/schemas";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	smallint,
	snakeCase,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const plugin = snakeCase.table(
	"plugin",
	{
		slug: text().notNull(),
		status: text().notNull(),
		version: text().notNull(),
		sourceHash: text().notNull(),
		scope: text().$type<"system" | "user">().notNull(),
		manifest: jsonb().$type<PluginManifest>().notNull(),
		sourceFiles: jsonb().$type<Record<string, string>>().notNull(),
		compiledHashes: jsonb().$type<Record<string, string>>().notNull(),
		ingestedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		ownerId: text().references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		index("plugin_owner_id_idx").on(table.ownerId),
		uniqueIndex("plugin_system_slug_unique")
			.on(table.slug)
			.where(sql`${table.scope} = 'system'`),
		uniqueIndex("plugin_owner_slug_unique")
			.on(table.ownerId, table.slug)
			.where(sql`${table.scope} = 'user'`),
		check(
			"plugin_scope_owner_check",
			sql`(${table.scope} = 'system' and ${table.ownerId} is null) or (${table.scope} = 'user' and ${table.ownerId} is not null)`,
		),
	],
);

export const pluginInstallation = snakeCase.table(
	"plugin_installation",
	{
		healthReason: text(),
		sortOrder: integer().notNull().default(0),
		isDisabled: boolean().notNull().default(false),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
		health: text()
			.$type<"installing" | "ready" | "needs-configuration" | "incompatible" | "failed">()
			.notNull()
			.default("ready"),
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
		index("plugin_installation_user_id_idx").on(table.userId),
		index("plugin_installation_plugin_id_idx").on(table.pluginId),
		unique("plugin_installation_user_plugin_unique").on(table.userId, table.pluginId),
	],
);

export const sandboxProvider = snakeCase.table(
	"sandbox_provider",
	{
		slug: text().notNull(),
		name: text().notNull(),
		rootEntitySchemaSlug: text().notNull(),
		information: jsonb().$type<ProviderInformation>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
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
		index("sandbox_provider_plugin_id_idx").on(table.pluginId),
		index("sandbox_provider_root_entity_schema_slug_idx").on(table.rootEntitySchemaSlug),
		unique("sandbox_provider_plugin_id_unique").on(table.pluginId, table.slug),
	],
);

export const sandboxScript = snakeCase.table(
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
		pluginId: text().references(() => plugin.id, { onDelete: "cascade" }),
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
		index("sandbox_script_plugin_id_idx").on(table.pluginId),
		unique("sandbox_script_plugin_id_content_hash_unique").on(
			table.pluginId,
			table.slug,
			table.contentHash,
		),
		uniqueIndex("sandbox_script_kernel_slug_content_hash_unique")
			.on(table.slug, table.contentHash)
			.where(sql`${table.pluginId} is null`),
	],
);

export const sandboxProviderOperation = snakeCase.table(
	"sandbox_provider_operation",
	{
		optionsSchema: jsonb().$type<AppSchema | null>(),
		operation: text().$type<PluginProviderOperation>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		scriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "restrict" }),
		providerId: text()
			.notNull()
			.references(() => sandboxProvider.id, { onDelete: "cascade" }),
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
		index("sandbox_provider_operation_provider_id_idx").on(table.providerId),
		index("sandbox_provider_operation_script_id_idx").on(table.scriptId),
		unique("sandbox_provider_operation_provider_operation_unique").on(
			table.providerId,
			table.operation,
		),
		unique("sandbox_provider_operation_script_id_unique").on(table.scriptId),
	],
);

export const sandboxWorkflowReference = snakeCase.table(
	"sandbox_workflow_reference",
	{
		contentHash: text().notNull(),
		executionId: text().primaryKey(),
		pluginInstallationId: text().references(() => pluginInstallation.id, {
			onDelete: "restrict",
		}),
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
		scriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("sandbox_workflow_reference_plugin_id_idx").on(table.pluginId),
		index("sandbox_workflow_reference_script_id_idx").on(table.scriptId),
		index("sandbox_workflow_reference_plugin_installation_id_idx").on(table.pluginInstallationId),
	],
);
