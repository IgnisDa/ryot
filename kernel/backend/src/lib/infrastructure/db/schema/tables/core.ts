import type {
	PluginManifest,
	PluginProviderOperation,
} from "@ryot-app/contract/modules/plugins/manifest";
import type {
	ProviderInformation,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/sandbox/schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	type AnyPgColumn,
	bytea,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	primaryKey,
	smallint,
	snakeCase,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { clientArtifact } from "./client-artifacts";

export const pluginConfigEncryptionKey = snakeCase.table(
	"plugin_config_encryption_key",
	{
		id: text().notNull(),
		key: bytea().notNull(),
		singleton: boolean().primaryKey().default(true),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check("plugin_config_encryption_key_singleton_check", sql`${table.singleton} = true`),
		check("plugin_config_encryption_key_length_check", sql`octet_length(${table.key}) = 32`),
	],
);

export const plugin = snakeCase.table(
	"plugin",
	{
		slug: text().notNull(),
		status: text().notNull(),
		environmentConfigRevisionId: text(),
		scope: text().$type<"system" | "user">().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		activeRevisionId: text().references((): AnyPgColumn => pluginRevision.id),
		ownerId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		check(
			"plugin_active_revision_check",
			sql`${table.status} <> 'active' or ${table.activeRevisionId} is not null`,
		),
		foreignKey({
			name: "plugin_active_revision_owner_fk",
			columns: [table.activeRevisionId, table.id],
			foreignColumns: [pluginRevision.id, pluginRevision.pluginId],
		}),
		foreignKey({
			name: "plugin_environment_config_revision_fk",
			columns: [table.environmentConfigRevisionId, table.activeRevisionId],
			foreignColumns: [pluginConfigRevision.id, pluginConfigRevision.pluginRevisionId],
		}),
		check(
			"plugin_environment_config_scope_check",
			sql`${table.scope} = 'system' or ${table.environmentConfigRevisionId} is null`,
		),
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

export const pluginRevision = snakeCase.table(
	"plugin_revision",
	{
		version: text().notNull(),
		clientArtifactHash: text(),
		sourceHash: text().notNull(),
		manifest: jsonb().$type<PluginManifest>().notNull(),
		clientConfigSchema: jsonb().$type<AppSchema>().notNull(),
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId()),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		pluginId: text()
			.notNull()
			.references((): AnyPgColumn => plugin.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("plugin_revision_plugin_source_unique").on(table.pluginId, table.sourceHash),
		unique("plugin_revision_id_plugin_unique").on(table.id, table.pluginId),
		foreignKey({
			columns: [table.clientArtifactHash],
			foreignColumns: [clientArtifact.hash],
			name: "plugin_revision_client_artifact_hash_fk",
		}),
	],
);

export const pluginRevisionSourceFile = snakeCase.table(
	"plugin_revision_source_file",
	{
		path: text().notNull(),
		contents: bytea().notNull(),
		pluginRevisionId: text()
			.notNull()
			.references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.pluginRevisionId, table.path] })],
);

export const pluginInstallation = snakeCase.table(
	"plugin_installation",
	{
		healthReason: text(),
		homeSavedViewId: text(),
		sortOrder: integer().notNull().default(0),
		isDisabled: boolean().notNull().default(false),
		uninstalledAt: timestamp({ withTimezone: true }),
		configuredSecretPaths: text().array().notNull().default([]),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		clientConfig: jsonb().$type<Record<string, JsonValue>>().notNull().default({}),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		activeConfigRevisionId: text().references((): AnyPgColumn => pluginConfigRevision.id),
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		health: text()
			.$type<"installing" | "ready" | "needs-configuration" | "incompatible" | "failed">()
			.notNull()
			.default("ready"),
	},
	(table) => [
		index("plugin_installation_user_id_idx").on(table.userId),
		index("plugin_installation_plugin_id_idx").on(table.pluginId),
		unique("plugin_installation_user_plugin_unique").on(table.userId, table.pluginId),
		unique("plugin_installation_id_user_id_unique").on(table.id, table.userId),
	],
);

export const pluginConfigRevision = snakeCase.table(
	"plugin_config_revision",
	{
		nonce: bytea().notNull(),
		encryptedPayload: bytea(),
		encryptionKeyId: text().notNull(),
		payloadFingerprint: text().notNull(),
		configuredKeys: text().array().notNull(),
		payloadPrunedAt: timestamp({ withTimezone: true }),
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId()),
		scope: text().$type<"environment" | "installation">().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		ownerUserId: text().references(() => user.id, { onDelete: "cascade" }),
		pluginRevisionId: text()
			.notNull()
			.references(() => pluginRevision.id, { onDelete: "cascade" }),
		pluginInstallationId: text().references((): AnyPgColumn => pluginInstallation.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("plugin_config_revision_installation_idx").on(table.pluginInstallationId),
		unique("plugin_config_revision_id_revision_unique").on(table.id, table.pluginRevisionId),
		index("plugin_config_revision_owner_idx").on(table.ownerUserId),
		index("plugin_config_revision_package_idx").on(table.pluginRevisionId),
		check(
			"plugin_config_revision_scope_check",
			sql`(${table.scope} = 'environment' and ${table.ownerUserId} is null and ${table.pluginInstallationId} is null) or (${table.scope} = 'installation' and ${table.ownerUserId} is not null)`,
		),
		check(
			"plugin_config_revision_payload_check",
			sql`(${table.encryptedPayload} is null) = (${table.payloadPrunedAt} is not null)`,
		),
		check(
			"plugin_config_revision_envelope_check",
			sql`octet_length(${table.nonce}) = 12 and (${table.encryptedPayload} is null or octet_length(${table.encryptedPayload}) >= 16)`,
		),
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
		providerId: text().references(() => sandboxProvider.id, { onDelete: "cascade" }),
		pluginRevisionId: text().references(() => pluginRevision.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		index("sandbox_script_provider_id_idx").on(table.providerId),
		unique("sandbox_script_id_revision_unique").on(table.id, table.pluginRevisionId),
		index("sandbox_script_plugin_revision_id_idx").on(table.pluginRevisionId),
		unique("sandbox_script_revision_content_hash_unique").on(
			table.pluginRevisionId,
			table.slug,
			table.contentHash,
		),
		uniqueIndex("sandbox_script_kernel_slug_content_hash_unique")
			.on(table.slug, table.contentHash)
			.where(sql`${table.pluginRevisionId} is null`),
	],
);

export const kernelScript = snakeCase.table("kernel_script", {
	slug: text().primaryKey(),
	scriptId: text()
		.notNull()
		.unique()
		.references(() => sandboxScript.id, { onDelete: "restrict" }),
});

export const sandboxProviderOperation = snakeCase.table(
	"sandbox_provider_operation",
	{
		optionsSchema: jsonb().$type<AppSchema | null>(),
		operation: text().$type<PluginProviderOperation>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		scriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "restrict" }),
		providerId: text()
			.notNull()
			.references(() => sandboxProvider.id, { onDelete: "cascade" }),
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
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
		pluginInstallationId: text().references(() => pluginInstallation.id, { onDelete: "restrict" }),
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
