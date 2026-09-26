import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import type {
	ProviderInformation,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { PLUGIN_PACKAGE_ID_PATTERN, type PluginPackageId } from "@ryot-app/contract/schema/brands";
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
	type PgTableExtraConfigValue,
	smallint,
	snakeCase,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import type { PluginSandboxAuthority } from "#modules/scripts/authorization/plugin-authority";

import { user } from "./auth";
import { clientArtifact } from "./client-artifacts";

export const pluginConfigEncryptionKey = snakeCase.table(
	"plugin_config_encryption_key",
	{
		id: text().notNull(),
		key: bytea().notNull(),
		singleton: boolean().primaryKey().default(true),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
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
		packageId: text().$type<PluginPackageId>().notNull(),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
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
		clientArtifactHash: text(),
		pluginId: text().notNull(),
		sourceHash: text().notNull(),
		manifest: jsonb().$type<PluginManifest>().notNull(),
		clientConfigSchema: jsonb().$type<AppSchema>().notNull(),
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId()),
		name: text().generatedAlwaysAs(sql`manifest -> 'metadata' ->> 'name'`),
		icon: text().generatedAlwaysAs(sql`manifest -> 'metadata' ->> 'icon'`),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
		description: text().generatedAlwaysAs(sql`manifest -> 'metadata' ->> 'description'`),
		packageId: text()
			.$type<PluginPackageId>()
			.notNull()
			.generatedAlwaysAs(sql`manifest -> 'metadata' ->> 'packageId'`),
	},
	(table): PgTableExtraConfigValue[] => [
		unique("plugin_revision_plugin_source_unique").on(table.pluginId, table.sourceHash),
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

export const pluginRevisionSandboxAuthority = snakeCase.view("plugin_revision_sandbox_authority", {
	id: text().notNull(),
	sandboxAuthority: jsonb().$type<PluginSandboxAuthority>().notNull(),
}).as(sql`
		select id, case
			when jsonb_typeof(manifest->'scripts') is distinct from 'array'
				or jsonb_typeof(manifest->'workflows') is distinct from 'array'
				or jsonb_typeof(manifest->'userBootstrap') is distinct from 'array'
				or jsonb_typeof(manifest->'entitySchemas') is distinct from 'array'
				or jsonb_typeof(manifest->'relationshipSchemas') is distinct from 'array'
				or jsonb_typeof(manifest->'signalSchemas') is distinct from 'array'
			then 'null'::jsonb
			when exists (
				select 1
				from jsonb_array_elements(manifest->'entitySchemas') as entities(entity_schema)
				where jsonb_typeof(entity_schema->'eventSchemas') is distinct from 'array'
			)
			then 'null'::jsonb
			else jsonb_build_object(
				'packageId', manifest->'metadata'->'packageId',
				'configSchema', manifest->'configSchema',
				'workflowScripts', coalesce(
					(
						select jsonb_object_agg(workflow->>'slug', workflow->'scriptSlug')
						from jsonb_array_elements(manifest->'workflows') as workflows(workflow)
					),
					'{}'::jsonb
				),
				'userBootstrapScriptSlugs', coalesce(
					(
						select jsonb_agg(bootstrap->'scriptSlug' order by bootstrap_position)
						from jsonb_array_elements(manifest->'userBootstrap')
							with ordinality as bootstraps(bootstrap, bootstrap_position)
					),
					'[]'::jsonb
				),
				'schemaScope', jsonb_build_object(
					'signalSchemaSlugs', coalesce(
						(
							select jsonb_agg(signal_schema->'slug' order by signal_position)
							from jsonb_array_elements(manifest->'signalSchemas')
								with ordinality as signals(signal_schema, signal_position)
						),
						'[]'::jsonb
					),
					'entitySchemaSlugs', coalesce(
						(
							select jsonb_agg(entity_schema->'slug' order by entity_position)
							from jsonb_array_elements(manifest->'entitySchemas')
								with ordinality as entities(entity_schema, entity_position)
						),
						'[]'::jsonb
					),
					'relationshipSchemaSlugs', coalesce(
						(
							select jsonb_agg(relationship_schema->'slug' order by relationship_position)
							from jsonb_array_elements(manifest->'relationshipSchemas')
								with ordinality as relationships(relationship_schema, relationship_position)
						),
						'[]'::jsonb
					),
					'eventSchemas', coalesce(
						(
							select jsonb_agg(
								jsonb_build_object(
									'eventSchemaSlug', event_schema->'slug',
									'entitySchemaSlug', entity_schema->'slug'
								)
								order by entity_position, event_position
							)
							from jsonb_array_elements(manifest->'entitySchemas')
								with ordinality as entities(entity_schema, entity_position)
							cross join lateral jsonb_array_elements(entity_schema->'eventSchemas')
								with ordinality as events(event_schema, event_position)
						),
						'[]'::jsonb
					)
				),
				'scriptKinds', coalesce(
					(
						select jsonb_object_agg(script->>'slug', script->'kind')
						from jsonb_array_elements(manifest->'scripts') as scripts(script)
					),
					'{}'::jsonb
				)
			)
		end as sandbox_authority
		from "plugin_revision"
	`);

export const pluginInstallation = snakeCase.table(
	"plugin_installation",
	{
		healthReason: text(),
		sortOrder: integer().notNull().default(0),
		isHidden: boolean().notNull().default(false),
		isInitialized: boolean().notNull().default(false),
		homeSavedView: jsonb().$type<SavedViewReference>(),
		ingestionRetiring: boolean().notNull().default(false),
		configuredSecretPaths: text().array().notNull().default([]),
		uninstalledAt: timestamp({ precision: 3, withTimezone: true }),
		incompatibilityReason: text().$type<"package-identity-conflict">(),
		clientConfig: jsonb().$type<Record<string, JsonValue>>().notNull().default({}),
		userSettings: jsonb().$type<Record<string, JsonValue>>().notNull().default({}),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
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
		updatedAt: timestamp({ precision: 3, withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		health: text()
			.$type<"installing" | "ready" | "needs-configuration" | "incompatible" | "failed">()
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
		encryptionKeyId: text().notNull(),
		payloadFingerprint: text().notNull(),
		configuredKeys: text().array().notNull(),
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId()),
		payloadPrunedAt: timestamp({ precision: 3, withTimezone: true }),
		ownerUserId: text().references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
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
		rootEntitySchemaSlug: text().notNull(),
		information: jsonb().$type<ProviderInformation>().notNull(),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ precision: 3, withTimezone: true })
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
		source: text(),
		slug: text().notNull(),
		name: text().notNull(),
		contentHash: text().notNull(),
		compiledCode: text().notNull(),
		compiledFormat: smallint().notNull().default(1),
		metadata: jsonb().$type<SandboxScriptMetadata>().notNull(),
		providerId: text().references(() => sandboxProvider.id, { onDelete: "cascade" }),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
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
