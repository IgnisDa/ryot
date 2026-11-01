import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import type {
	ProviderInformation,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/scripts/schemas";
import { PLUGIN_PACKAGE_ID_PATTERN, type PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	bytea,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	type PgTableExtraConfigValue,
	smallint,
	snakeCase,
	text,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import type { PluginSandboxAuthority } from "#modules/scripts/authorization/plugin-authority";

import { user } from "./auth";
import { clientArtifact } from "./client-artifacts";
import { timestamptz, updatedAtColumn } from "./timestamps";

export const pluginConfigEncryptionKey = snakeCase.table(
	"plugin_config_encryption_key",
	{
		id: text().notNull(),
		key: bytea().notNull(),
		singleton: boolean().primaryKey().default(true),
		createdAt: timestamptz().defaultNow().notNull(),
	},
	(table) => [
		check("plugin_config_encryption_key_singleton_check", sql`${table.singleton} = true`),
		check("plugin_config_encryption_key_length_check", sql`octet_length(${table.key}) = 32`),
	],
);

export const plugin = snakeCase.table(
	"plugin",
	{
		status: text().notNull(),
		activeRevisionId: text(),
		environmentConfigRevisionId: text(),
		createdAt: timestamptz().defaultNow().notNull(),
		packageId: text().$type<PluginPackageId>().notNull(),
		ownerId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
		activationId: text()
			.notNull()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		check(
			"plugin_package_id_format_check",
			sql`${table.packageId} ~ ${sql.raw(`'${PLUGIN_PACKAGE_ID_PATTERN}'`)}`,
		),
		unique("plugin_id_package_unique").on(table.id, table.packageId),
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
			sql`${table.ownerId} is null or ${table.environmentConfigRevisionId} is null`,
		),
		index("plugin_owner_id_idx").on(table.ownerId),
		uniqueIndex("plugin_owner_package_id_unique").on(
			table.packageId,
			sql`(case when ${table.ownerId} is null then '0' else '1' || ${table.ownerId} end)`,
		),
	],
);

export const pluginUninstallReceipt = snakeCase.table("plugin_uninstall_receipt", {
	installationId: text(),
	pluginId: text().notNull(),
	activationId: text().primaryKey(),
	packageId: text().$type<PluginPackageId>().notNull(),
	ownerId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
});

export const pluginRevision = snakeCase.table(
	"plugin_revision",
	{
		name: text(),
		icon: text(),
		description: text(),
		version: text().notNull(),
		clientArtifactHash: text(),
		pluginId: text().notNull(),
		contentHash: text().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		client: jsonb().$type<PluginManifest["client"]>(),
		packageId: text().$type<PluginPackageId>().notNull(),
		clientConfigSchema: jsonb().$type<AppSchema>().notNull(),
		hooks: jsonb().$type<PluginManifest["hooks"]>().notNull(),
		crons: jsonb().$type<PluginManifest["crons"]>().notNull(),
		scripts: jsonb().$type<PluginManifest["scripts"]>().notNull(),
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId()),
		workflows: jsonb().$type<PluginManifest["workflows"]>().notNull(),
		providers: jsonb().$type<PluginManifest["providers"]>().notNull(),
		oauthProviders: jsonb().$type<PluginManifest["oauthProviders"]>(),
		sandboxAuthority: jsonb().$type<PluginSandboxAuthority>().notNull(),
		operations: jsonb().$type<PluginManifest["operations"]>().notNull(),
		configSchema: jsonb().$type<PluginManifest["configSchema"]>().notNull(),
		signalSchemas: jsonb().$type<PluginManifest["signalSchemas"]>().notNull(),
		entitySchemas: jsonb().$type<PluginManifest["entitySchemas"]>().notNull(),
		userBootstrap: jsonb().$type<PluginManifest["userBootstrap"]>().notNull(),
		userSettingsSchema: jsonb().$type<PluginManifest["userSettingsSchema"]>(),
		httpRateLimits: jsonb().$type<PluginManifest["httpRateLimits"]>().notNull(),
		relationshipSchemas: jsonb().$type<PluginManifest["relationshipSchemas"]>().notNull(),
		integrationProviders: jsonb().$type<PluginManifest["integrationProviders"]>().notNull(),
	},
	(table): PgTableExtraConfigValue[] => [
		unique("plugin_revision_plugin_content_unique").on(table.pluginId, table.contentHash),
		unique("plugin_revision_id_plugin_unique").on(table.id, table.pluginId),
		foreignKey({
			name: "plugin_revision_owner_package_fk",
			columns: [table.pluginId, table.packageId],
			foreignColumns: [plugin.id, plugin.packageId],
		})
			.onDelete("cascade")
			.onUpdate("restrict"),
		foreignKey({
			name: "plugin_revision_client_artifact_package_fk",
			columns: [table.clientArtifactHash, table.packageId],
			foreignColumns: [clientArtifact.hash, clientArtifact.packageId],
		}),
	],
);

export const pluginRevisionManifest = snakeCase.table("plugin_revision_manifest", {
	manifest: jsonb().$type<PluginManifest>().notNull(),
	pluginRevisionId: text()
		.primaryKey()
		.references(() => pluginRevision.id, { onDelete: "cascade" }),
});

export const pluginInstallation = snakeCase.table(
	"plugin_installation",
	{
		healthReason: text(),
		uninstalledAt: timestamptz(),
		updatedAt: updatedAtColumn(),
		sortOrder: integer().notNull().default(0),
		isHidden: boolean().notNull().default(false),
		createdAt: timestamptz().defaultNow().notNull(),
		isInitialized: boolean().notNull().default(false),
		homeSavedView: jsonb().$type<SavedViewReference>(),
		ingestionRetiring: boolean().notNull().default(false),
		configuredSecretPaths: text().array().notNull().default([]),
		incompatibilityReason: text().$type<"package-identity-conflict">(),
		clientConfig: jsonb().$type<Record<string, JsonValue>>().notNull().default({}),
		userSettings: jsonb().$type<Record<string, JsonValue>>().notNull().default({}),
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
		health: text()
			.$type<"ready" | "failed" | "installing" | "incompatible" | "needs-configuration">()
			.notNull()
			.default("ready"),
	},
	(table) => [
		check(
			"plugin_installation_incompatibility_reason_check",
			sql`${table.incompatibilityReason} is null or (${table.incompatibilityReason} = 'package-identity-conflict' and ${table.health} = 'incompatible')`,
		),
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
		payloadPrunedAt: timestamptz(),
		encryptionKeyId: text().notNull(),
		payloadFingerprint: text().notNull(),
		configuredKeys: text().array().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId()),
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
			sql`${table.ownerUserId} is not null or ${table.pluginInstallationId} is null`,
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
		updatedAt: updatedAtColumn(),
		rootEntitySchemaSlug: text().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		information: jsonb().$type<ProviderInformation>().notNull(),
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
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
		source: text(),
		slug: text().notNull(),
		name: text().notNull(),
		contentHash: text().notNull(),
		compiledCode: text().notNull(),
		compiledFormat: smallint().notNull().default(1),
		createdAt: timestamptz().defaultNow().notNull(),
		metadata: jsonb().$type<SandboxScriptMetadata>().notNull(),
		providerId: text().references(() => sandboxProvider.id, { onDelete: "cascade" }),
		pluginRevisionId: text().references(() => pluginRevision.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		check(
			"sandbox_script_source_owner_check",
			sql`(${table.pluginRevisionId} is null) = (${table.source} is not null)`,
		),
		index("sandbox_script_provider_id_idx").on(table.providerId),
		unique("sandbox_script_id_revision_unique").on(table.id, table.pluginRevisionId),
		index("sandbox_script_plugin_revision_id_idx").on(table.pluginRevisionId),
		unique("sandbox_script_revision_slug_unique").on(table.pluginRevisionId, table.slug),
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

export const sandboxWorkflowReference = snakeCase.table(
	"sandbox_workflow_reference",
	{
		executionId: text().primaryKey(),
		pluginInstallationId: text().references(() => pluginInstallation.id, { onDelete: "restrict" }),
		scriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("sandbox_workflow_reference_script_id_idx").on(table.scriptId),
		index("sandbox_workflow_reference_plugin_installation_id_idx").on(table.pluginInstallationId),
	],
);
