import type { FieldSelection, RowSelection } from "@ryot-app/contract/modules/ryotql/language";
import { KernelSavedViewRendererName } from "@ryot-app/contract/modules/saved-views/schemas";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { sql } from "drizzle-orm";

import { automationRunRetryEligibility } from "#lib/infrastructure/db/automation-retry-eligibility";

export type CatalogFieldKind = "boolean" | "date" | "json" | "number" | "text";

export type CatalogFieldContext = { readonly sqlAlias: string; readonly language: string | null };

export type CatalogField = {
	readonly kind: CatalogFieldKind;
	readonly nullable: boolean;
	readonly access?: "admin" | "kernel";
	readonly demoReadable?: false;
	readonly resolve: (context: CatalogFieldContext) => ReturnType<typeof sql>;
};

type CatalogUserPolicy =
	| { readonly type: "public" }
	| { readonly type: "self"; readonly column: string }
	| {
			readonly type: "owned";
			readonly column: string;
			readonly includeGlobal: boolean;
			readonly where?: string;
	  }
	| {
			readonly column: string;
			readonly type: "parentOwned";
			readonly parentTable: string;
			readonly parentColumn: string;
			readonly parentOwnerColumn: string;
	  };

export type CatalogVisibility = {
	readonly user?: CatalogUserPolicy & {
		readonly pluginReadable: boolean;
		readonly demoReadable?: false;
	};
	readonly admin?: { readonly type: "all" };
	readonly plugin?:
		| { readonly type: "eventDefinition" }
		| {
				readonly column: string;
				readonly globalOnly: boolean;
				readonly type: "discriminator";
				readonly ownership: "entitySchemaSlugs" | "relationshipSchemaSlugs";
		  };
};

export type RyotQLAudience = "kernel" | "plugin";

type UserExecutionScope = {
	readonly type: "user";
	readonly userId: string;
	readonly language: string | null;
	readonly audience: RyotQLAudience;
	readonly accessClass: AccessClass;
};

type PluginExecutionScope = {
	readonly type: "plugin";
	readonly pluginSlug: string;
	readonly entitySchemaSlugs: readonly string[];
	readonly relationshipSchemaSlugs: readonly string[];
	readonly eventSchemas: readonly {
		readonly eventSchemaSlug: string;
		readonly entitySchemaSlug: string;
	}[];
};

export type RyotQLExecutionScope =
	| UserExecutionScope
	| { readonly type: "admin" }
	| PluginExecutionScope;

export type RyotQLAccess =
	| Pick<UserExecutionScope, "accessClass" | "audience" | "type">
	| { readonly type: "admin" }
	| Pick<PluginExecutionScope, "type">;

export type CatalogTable = {
	readonly name: string;
	readonly primaryKey: readonly [string, ...string[]];
	readonly visibility: CatalogVisibility;
	readonly fields: Readonly<Record<string, CatalogField>>;
};

type ExpandedCatalogSelections = {
	readonly error: string | null;
	readonly fields: FieldSelection[];
};

const physicalField = (column: string, kind: CatalogFieldKind, nullable = true): CatalogField => ({
	kind,
	nullable,
	resolve: ({ sqlAlias }) => sql`${sql.raw(sqlAlias)}.${sql.identifier(column)}`,
});

const textArrayField = (column: string): CatalogField => ({
	kind: "json",
	nullable: false,
	resolve: ({ sqlAlias }) => sql`to_jsonb(${sql.raw(sqlAlias)}.${sql.identifier(column)})`,
});

const withAccess = (field: CatalogField, access: "admin" | "kernel"): CatalogField => ({
	...field,
	access,
});

const standardOnly = (field: CatalogField): CatalogField => ({ ...field, demoReadable: false });

const installationPluginSlug = (nullable: boolean): CatalogField => ({
	nullable,
	kind: "text",
	resolve: ({ sqlAlias }) =>
		sql.raw(
			`(SELECT plugin.slug FROM plugin_installation installation INNER JOIN plugin ON plugin.id = installation.plugin_id WHERE installation.id = ${sqlAlias}.plugin_installation_id)`,
		),
});

const pluginActiveRevisionField = (
	expression: string,
	kind: CatalogFieldKind,
	nullable: boolean,
): CatalogField => ({
	kind,
	nullable,
	resolve: ({ sqlAlias }) =>
		sql.raw(
			`(SELECT ${expression} FROM plugin_revision revision WHERE revision.id = ${sqlAlias}.active_revision_id)`,
		),
});

const pluginMetadataField = (key: "description" | "icon" | "name"): CatalogField =>
	pluginActiveRevisionField(`revision.manifest -> 'metadata' ->> '${key}'`, "text", true);

const pluginClientApiVersion = pluginActiveRevisionField(
	`(revision.manifest -> 'client' ->> 'apiVersion')::int`,
	"number",
	true,
);

const localizedEntityName: CatalogField = {
	kind: "text",
	nullable: false,
	resolve: ({ language, sqlAlias }) =>
		language === null
			? sql.raw(`${sqlAlias}.name`)
			: sql`COALESCE((SELECT translation.name FROM entity_translation translation WHERE translation.entity_id = ${sql.raw(`${sqlAlias}.id`)} AND translation.language = ${language}), ${sql.raw(`${sqlAlias}.name`)})`,
};

const localizedEntityProperties: CatalogField = {
	kind: "json",
	nullable: false,
	resolve: ({ language, sqlAlias }) =>
		language === null
			? sql.raw(`${sqlAlias}.properties`)
			: sql`${sql.raw(`${sqlAlias}.properties`)} || COALESCE((SELECT translation.properties FROM entity_translation translation WHERE translation.entity_id = ${sql.raw(`${sqlAlias}.id`)} AND translation.language = ${language}), '{}'::jsonb)`,
};

const entityTranslationStatus: CatalogField = {
	kind: "text",
	nullable: false,
	resolve: ({ language, sqlAlias }) => {
		if (language === null) {
			return sql`'none'::text`;
		}
		const id = sql.raw(`${sqlAlias}.id`);
		const providerId = sql.raw(`${sqlAlias}.provider_id`);
		const populatedAt = sql.raw(`${sqlAlias}.populated_at`);
		const canonicalLanguage = sql`(SELECT provider.information ->> 'canonicalLanguage' FROM sandbox_provider provider WHERE provider.id = ${providerId})`;
		return sql`CASE
			WHEN ${providerId} IS NULL THEN 'none'
			WHEN ${canonicalLanguage} IS NULL THEN 'none'
			WHEN ${canonicalLanguage} = ${language} THEN 'none'
			WHEN ${populatedAt} IS NULL THEN 'none'
			WHEN NOT EXISTS (SELECT 1 FROM entity_translation translation WHERE translation.entity_id = ${id} AND translation.language = ${language}) THEN 'pending'
			WHEN (SELECT translation.name IS NULL AND (translation.properties IS NULL OR translation.properties = '{}'::jsonb) FROM entity_translation translation WHERE translation.entity_id = ${id} AND translation.language = ${language}) THEN 'none'
			ELSE 'ready'
		END`;
	},
};

const entityPopulationStatus: CatalogField = {
	kind: "text",
	nullable: false,
	resolve: ({ sqlAlias }) => {
		const providerId = sql.raw(`${sqlAlias}.provider_id`);
		const externalId = sql.raw(`${sqlAlias}.external_id`);
		const populatedAt = sql.raw(`${sqlAlias}.populated_at`);
		return sql`CASE
			WHEN ${populatedAt} IS NOT NULL THEN 'ready'
			WHEN ${providerId} IS NULL OR ${externalId} IS NULL THEN 'none'
			ELSE 'pending'
		END`;
	},
};

const entity: CatalogTable = {
	name: "entity",
	primaryKey: ["id"],
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: true, pluginReadable: true },
		plugin: {
			globalOnly: true,
			type: "discriminator",
			column: "entity_schema_slug",
			ownership: "entitySchemaSlugs",
		},
	},
	fields: {
		name: localizedEntityName,
		properties: localizedEntityProperties,
		id: physicalField("id", "text", false),
		populationStatus: entityPopulationStatus,
		userId: physicalField("user_id", "text"),
		translationStatus: entityTranslationStatus,
		externalId: physicalField("external_id", "text"),
		providerId: physicalField("provider_id", "text"),
		populatedAt: physicalField("populated_at", "date"),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		entitySchemaSlug: physicalField("entity_schema_slug", "text", false),
		entitySchemaPluginId: physicalField("entity_schema_plugin_id", "text"),
	},
};

const event: CatalogTable = {
	name: "event",
	primaryKey: ["id"],
	visibility: {
		plugin: { type: "eventDefinition" },
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		id: physicalField("id", "text", false),
		userId: physicalField("user_id", "text", false),
		entityId: physicalField("entity_id", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		properties: physicalField("properties", "json", false),
		occurredAt: physicalField("occurred_at", "date", false),
		sessionEntityId: physicalField("session_entity_id", "text"),
		eventSchemaSlug: physicalField("event_schema_slug", "text", false),
	},
};

const relationship: CatalogTable = {
	primaryKey: ["id"],
	name: "relationship",
	visibility: {
		admin: { type: "all" },
		user: { type: "owned", column: "user_id", includeGlobal: true, pluginReadable: true },
		plugin: {
			globalOnly: false,
			type: "discriminator",
			column: "relationship_schema_slug",
			ownership: "relationshipSchemaSlugs",
		},
	},
	fields: {
		id: physicalField("id", "text", false),
		userId: physicalField("user_id", "text"),
		createdAt: physicalField("created_at", "date", false),
		properties: physicalField("properties", "json", false),
		sourceEntityId: physicalField("source_entity_id", "text", false),
		targetEntityId: physicalField("target_entity_id", "text", false),
		relationshipSchemaSlug: physicalField("relationship_schema_slug", "text", false),
	},
};

const plugin: CatalogTable = {
	name: "plugin",
	primaryKey: ["id"],
	visibility: {
		admin: { type: "all" },
		user: { type: "owned", includeGlobal: true, pluginReadable: true, column: "owner_user_id" },
	},
	fields: {
		icon: pluginMetadataField("icon"),
		name: pluginMetadataField("name"),
		id: physicalField("id", "text", false),
		clientApiVersion: pluginClientApiVersion,
		slug: physicalField("slug", "text", false),
		scope: physicalField("scope", "text", false),
		status: physicalField("status", "text", false),
		description: pluginMetadataField("description"),
		activeRevisionId: physicalField("active_revision_id", "text"),
		version: pluginActiveRevisionField("revision.version", "text", true),
		ingestedAt: pluginActiveRevisionField("revision.created_at", "date", true),
		sourceHash: pluginActiveRevisionField("revision.source_hash", "text", true),
		configSchema: pluginActiveRevisionField("revision.client_config_schema", "json", true),
		environmentConfigRevisionId: withAccess(
			physicalField("environment_config_revision_id", "text"),
			"admin",
		),
	},
};

const kernelSavedViewRendererNames = KernelSavedViewRendererName.literals
	.map((name) => `'${name}'`)
	.join(", ");

const usableHomeSavedView = (
	view: string,
	userId: string,
) => `NOT ${view}.is_disabled AND CASE ${view}.renderer ->> 'kind'
	WHEN 'kernel' THEN COALESCE(${view}.renderer ->> 'name' IN (${kernelSavedViewRendererNames}), false)
	WHEN 'plugin' THEN EXISTS (
		SELECT 1 FROM user_plugin home_renderer_plugin
		INNER JOIN plugin_revision home_renderer_revision ON home_renderer_revision.id = home_renderer_plugin.active_revision_id
		WHERE home_renderer_plugin.user_id = ${userId}
			AND home_renderer_plugin.plugin_id = ${view}.renderer ->> 'pluginId'
			AND home_renderer_plugin.health = 'ready'
			AND NOT home_renderer_plugin.is_disabled
			AND home_renderer_revision.manifest -> 'client' -> 'exports' -> (${view}.renderer ->> 'exportName') ->> 'kind' = 'page'
	)
	ELSE false
END`;

const effectiveHomeSavedViewSlug: CatalogField = {
	kind: "text",
	nullable: true,
	resolve: ({ sqlAlias }) =>
		sql.raw(`COALESCE(
			(SELECT home_selected.slug FROM user_saved_view_effective home_selected
				WHERE home_selected.slug = ${sqlAlias}.home_saved_view_slug
					AND home_selected.user_id = ${sqlAlias}.user_id
					AND ${usableHomeSavedView("home_selected", `${sqlAlias}.user_id`)}),
			(SELECT home_fallback.slug FROM plugin home_plugin
				INNER JOIN plugin_revision home_revision ON home_revision.id = home_plugin.active_revision_id
				INNER JOIN user_saved_view_effective home_fallback ON home_fallback.slug = home_revision.manifest -> 'client' ->> 'homeView'
				WHERE home_plugin.id = ${sqlAlias}.plugin_id
					AND home_plugin.status = 'active'
					AND (home_plugin.scope = 'system' OR home_plugin.owner_user_id = ${sqlAlias}.user_id)
					AND home_fallback.user_id = ${sqlAlias}.user_id
					AND home_fallback.is_builtin
					AND home_fallback.plugin_installation_id = ${sqlAlias}.id
					AND ${usableHomeSavedView("home_fallback", `${sqlAlias}.user_id`)})
		)`),
};

const pluginInstallation: CatalogTable = {
	primaryKey: ["id"],
	name: "plugin_installation",
	visibility: {
		admin: { type: "all" },
		user: {
			type: "owned",
			column: "user_id",
			includeGlobal: false,
			pluginReadable: true,
			where: "uninstalled_at IS NULL",
		},
	},
	fields: {
		id: physicalField("id", "text", false),
		homeSavedViewSlug: effectiveHomeSavedViewSlug,
		health: physicalField("health", "text", false),
		pluginId: physicalField("plugin_id", "text", false),
		healthReason: physicalField("health_reason", "text"),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		sortOrder: physicalField("sort_order", "number", false),
		isDisabled: physicalField("is_disabled", "boolean", false),
		config: withAccess(physicalField("client_config", "json", false), "kernel"),
		configuredSecrets: withAccess(textArrayField("configured_secret_paths"), "kernel"),
	},
};

const definitionFields = {
	id: physicalField("id", "text", false),
	slug: physicalField("slug", "text", false),
	name: physicalField("name", "text", false),
	pluginId: physicalField("plugin_id", "text"),
	propertiesSchema: physicalField("properties_schema", "json", false),
};

const effectiveDefinitionVisibility: CatalogVisibility = {
	user: {
		type: "owned",
		column: "user_id",
		includeGlobal: false,
		pluginReadable: true,
		where: "is_effective",
	},
};

const entitySchema: CatalogTable = {
	primaryKey: ["id"],
	name: "user_entity_schema",
	visibility: effectiveDefinitionVisibility,
	fields: {
		...definitionFields,
		icon: physicalField("icon", "text", false),
		userState: physicalField("user_state", "json"),
		pluginSlug: physicalField("plugin_slug", "text"),
		mergeIdentityProperties: textArrayField("merge_identity_properties"),
	},
};

const eventSchema: CatalogTable = {
	primaryKey: ["id"],
	name: "user_event_schema",
	visibility: effectiveDefinitionVisibility,
	fields: {
		...definitionFields,
		entitySchemaSlug: physicalField("entity_schema_slug", "text", false),
		pluginSlug: {
			kind: "text",
			nullable: true,
			resolve: ({ sqlAlias }) =>
				sql.raw(`(SELECT plugin.slug FROM plugin WHERE plugin.id = ${sqlAlias}.plugin_id)`),
		},
	},
};

const relationshipSchema: CatalogTable = {
	primaryKey: ["id"],
	name: "user_relationship_schema",
	visibility: effectiveDefinitionVisibility,
	fields: {
		...definitionFields,
		pluginSlug: physicalField("plugin_slug", "text"),
		sourceEntitySchemaSlug: physicalField("source_entity_schema_slug", "text"),
		targetEntitySchemaSlug: physicalField("target_entity_schema_slug", "text"),
	},
};

const signalSchema: CatalogTable = {
	primaryKey: ["id"],
	name: "user_signal_schema",
	visibility: effectiveDefinitionVisibility,
	fields: {
		...definitionFields,
		pluginSlug: physicalField("plugin_slug", "text"),
		catalogState: physicalField("catalog_state", "text", false),
		audiencePolicy: physicalField("audience_policy", "json", false),
	},
};

const executableDefinitionVisibility: CatalogVisibility = {
	user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: false },
};

const executableDefinitionFields = {
	id: physicalField("id", "text", false),
	slug: physicalField("slug", "text", false),
	name: physicalField("name", "text", false),
	pluginSlug: physicalField("plugin_slug", "text", false),
	description: physicalField("description", "text", false),
};

const pluginConfigEnvironmentSegment = (value: string) =>
	`upper(regexp_replace(regexp_replace(regexp_replace(${value}, '([a-z0-9])([A-Z])', '\\1_\\2', 'g'), '[^a-zA-Z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'))`;

const missingPluginConfigKeys = (sqlAlias: string) => `CASE
	WHEN ${sqlAlias}.plugin_scope <> 'system' THEN CASE WHEN ${sqlAlias}.config_revision_id IS NULL THEN to_jsonb(${sqlAlias}.required_plugin_config_keys) ELSE '[]'::jsonb END
	ELSE COALESCE((
		SELECT jsonb_agg('RYOT_PLUGIN_' || ${pluginConfigEnvironmentSegment(`${sqlAlias}.plugin_slug`)} || '_' || ${pluginConfigEnvironmentSegment("required_key.key")} ORDER BY required_key.position)
		FROM unnest(${sqlAlias}.required_plugin_config_keys) WITH ORDINALITY required_key(key, position)
		WHERE NOT required_key.key = ANY(COALESCE((SELECT configured.configured_keys FROM plugin_config_revision configured WHERE configured.id = ${sqlAlias}.config_revision_id), '{}'))
	), '[]'::jsonb)
END`;

const importSource: CatalogTable = {
	primaryKey: ["id"],
	name: "user_import_source",
	visibility: executableDefinitionVisibility,
	fields: {
		...executableDefinitionFields,
		exportHelp: physicalField("export_help", "json"),
		inputSchema: physicalField("input_schema", "json", false),
		workflowSlug: physicalField("workflow_slug", "text", false),
		requiredPluginConfigKeys: textArrayField("required_plugin_config_keys"),
		missingPluginConfigKeys: {
			kind: "json",
			nullable: false,
			resolve: ({ sqlAlias }) => sql.raw(missingPluginConfigKeys(sqlAlias)),
		},
		isStartable: {
			kind: "boolean",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(${sqlAlias}.workflow_script_id IS NOT NULL AND jsonb_array_length(${missingPluginConfigKeys(sqlAlias)}) = 0)`,
				),
		},
	},
};

const integrationProvider: CatalogTable = {
	primaryKey: ["id"],
	name: "user_integration_provider",
	visibility: executableDefinitionVisibility,
	fields: {
		...executableDefinitionFields,
		lot: physicalField("lot", "text", false),
		settingsSchema: physicalField("settings_schema", "json", false),
		requiresProKey: physicalField("requires_pro_key", "boolean", false),
		hasScript: {
			kind: "boolean",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql.raw(`(${sqlAlias}.lot = 'push' OR ${sqlAlias}.script_id IS NOT NULL)`),
		},
	},
};

const sandboxProvider: CatalogTable = {
	primaryKey: ["id"],
	name: "user_sandbox_provider",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		id: physicalField("id", "text", false),
		slug: physicalField("slug", "text", false),
		name: physicalField("name", "text", false),
		pluginId: physicalField("plugin_id", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		information: physicalField("information", "json", false),
		rootEntitySchemaSlug: physicalField("root_entity_schema_slug", "text", false),
	},
};

const sandboxProviderOperation: CatalogTable = {
	primaryKey: ["id"],
	name: "sandbox_provider_operation",
	visibility: {
		user: {
			parentColumn: "id",
			type: "parentOwned",
			pluginReadable: true,
			column: "provider_id",
			parentOwnerColumn: "user_id",
			parentTable: "user_sandbox_provider",
		},
	},
	fields: {
		id: physicalField("id", "text", false),
		operation: physicalField("operation", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		optionsSchema: physicalField("options_schema", "json"),
		providerId: physicalField("provider_id", "text", false),
	},
};

const savedView: CatalogTable = {
	primaryKey: ["id"],
	name: "user_saved_view_effective",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		id: physicalField("id", "text", false),
		pluginSlug: installationPluginSlug(true),
		slug: physicalField("slug", "text", false),
		name: physicalField("name", "text", false),
		icon: physicalField("icon", "text", false),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		renderer: physicalField("renderer", "json", false),
		settings: physicalField("settings", "json", false),
		dataSources: physicalField("data_sources", "json"),
		sortOrder: physicalField("sort_order", "number", false),
		isBuiltin: physicalField("is_builtin", "boolean", false),
		isDisabled: physicalField("is_disabled", "boolean", false),
	},
};

const notificationChannel: CatalogTable = {
	primaryKey: ["id"],
	name: "notification_channel",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		id: physicalField("id", "text", false),
		channel: physicalField("platform", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		description: physicalField("description", "text", false),
		isDisabled: physicalField("is_disabled", "boolean", false),
	},
};

const notificationSubscription: CatalogTable = {
	primaryKey: ["id"],
	name: "notification_subscription",
	visibility: {
		admin: { type: "all" },
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		id: physicalField("id", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		isActive: physicalField("is_active", "boolean", false),
		signalSchemaSlug: physicalField("signal_schema_slug", "text", false),
		userId: withAccess(physicalField("user_id", "text", false), "admin"),
	},
};

const integration: CatalogTable = {
	primaryKey: ["id"],
	name: "integration",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		name: physicalField("name", "text"),
		id: physicalField("id", "text", false),
		lot: physicalField("lot", "text", false),
		pluginSlug: installationPluginSlug(false),
		provider: physicalField("provider", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		lastFinishedAt: physicalField("last_finished_at", "date"),
		isDisabled: physicalField("is_disabled", "boolean", false),
		extraSettings: physicalField("extra_settings", "json", false),
		syncOwnership: physicalField("sync_ownership", "boolean", false),
		minimumProgress: physicalField("minimum_progress", "number", false),
		maximumProgress: physicalField("maximum_progress", "number", false),
		webhookToken: standardOnly(withAccess(physicalField("webhook_token", "text"), "kernel")),
		providerSpecifics: standardOnly(
			withAccess(physicalField("client_provider_specifics", "json", false), "kernel"),
		),
	},
};

const importRun: CatalogTable = {
	primaryKey: ["id"],
	name: "import_run",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		id: physicalField("id", "text", false),
		startedAt: physicalField("started_at", "date"),
		source: physicalField("source", "text", false),
		status: physicalField("status", "text", false),
		finishedAt: physicalField("finished_at", "date"),
		totalItems: physicalField("total_items", "number"),
		progress: physicalField("progress", "number", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		failureReason: physicalField("failure_reason", "json"),
		integrationId: physicalField("integration_id", "text"),
		failedItems: physicalField("failed_items", "number", false),
		inputSummary: physicalField("input_summary", "json", false),
		importedItems: physicalField("imported_items", "number", false),
		processedItems: physicalField("processed_items", "number", false),
	},
};

const importRunFailure: CatalogTable = {
	primaryKey: ["id"],
	name: "import_run_failure",
	visibility: {
		user: {
			column: "run_id",
			parentColumn: "id",
			type: "parentOwned",
			pluginReadable: true,
			parentTable: "import_run",
			parentOwnerColumn: "user_id",
		},
	},
	fields: {
		id: physicalField("id", "text", false),
		stage: physicalField("stage", "text", false),
		runId: physicalField("run_id", "text", false),
		reason: physicalField("reason", "json", false),
		sourceLabel: physicalField("source_label", "text"),
		createdAt: physicalField("created_at", "date", false),
		itemIndex: physicalField("item_index", "number", false),
		eventSchemaSlug: physicalField("event_schema_slug", "text"),
		sourceIdentifier: physicalField("source_identifier", "text"),
		entitySchemaSlug: physicalField("entity_schema_slug", "text"),
	},
};

const accountProviderExists = (sqlAlias: string, providerId: string) =>
	`EXISTS (SELECT 1 FROM account WHERE account.user_id = ${sqlAlias}.id AND account.provider_id = '${providerId}')`;

const user: CatalogTable = {
	name: "user",
	primaryKey: ["id"],
	visibility: {
		admin: { type: "all" },
		user: { type: "self", column: "id", pluginReadable: false },
	},
	fields: {
		image: physicalField("image", "text"),
		id: physicalField("id", "text", false),
		name: physicalField("name", "text", false),
		email: physicalField("email", "text", false),
		createdAt: physicalField("created_at", "date", false),
		preferences: physicalField("preferences", "json", false),
		disabledAt: withAccess(physicalField("disabled_at", "date"), "admin"),
		twoFactorEnabled: withAccess(physicalField("two_factor_enabled", "boolean"), "admin"),
		authState: withAccess(
			{
				kind: "text",
				nullable: false,
				resolve: ({ sqlAlias }) => {
					const credential = accountProviderExists(sqlAlias, "credential");
					const oidc = accountProviderExists(sqlAlias, "oidc");
					return sql.raw(`CASE
						WHEN ${credential} AND ${oidc} THEN 'mixed'
						WHEN ${credential} THEN 'credential'
						WHEN ${oidc} THEN 'oidc'
						ELSE 'none'
					END`);
				},
			},
			"admin",
		),
	},
};

const backupRun: CatalogTable = {
	primaryKey: ["id"],
	name: "backup_run",
	visibility: {
		user: {
			type: "owned",
			column: "user_id",
			demoReadable: false,
			includeGlobal: false,
			pluginReadable: false,
		},
	},
	fields: {
		id: physicalField("id", "text", false),
		failure: physicalField("failure", "json"),
		kind: physicalField("kind", "text", false),
		status: physicalField("status", "text", false),
		startedAt: physicalField("started_at", "date"),
		expiresAt: physicalField("expires_at", "date"),
		finishedAt: physicalField("finished_at", "date"),
		progress: physicalField("progress", "number", false),
		createdAt: physicalField("created_at", "date", false),
		artifactProvider: physicalField("artifact_provider", "text"),
	},
};

const automationTriggerKind = (triggerAlias: string) =>
	`jsonb_build_object('category', ${triggerAlias}.category, 'operation', ${triggerAlias}.operation, 'resource', ${triggerAlias}.resource_kind)`;

const automationTrigger: CatalogTable = {
	primaryKey: ["id"],
	name: "automation_trigger",
	visibility: {
		admin: { type: "all" },
		user: {
			column: "id",
			type: "parentOwned",
			pluginReadable: false,
			parentColumn: "trigger_id",
			parentTable: "automation_run",
			parentOwnerColumn: "execution_user_id",
		},
	},
	fields: {
		id: physicalField("id", "text", false),
		category: physicalField("category", "text", false),
		operation: physicalField("operation", "text", false),
		occurredAt: physicalField("occurred_at", "date", false),
		payloadPrunedAt: physicalField("payload_pruned_at", "date"),
		resourceKind: physicalField("resource_kind", "text", false),
		payload: withAccess(physicalField("payload", "json"), "admin"),
		depth: withAccess(physicalField("depth", "number", false), "admin"),
		source: withAccess(physicalField("source", "text", false), "admin"),
		initiatorId: withAccess(physicalField("initiator_id", "text"), "admin"),
		parentRunId: withAccess(physicalField("parent_run_id", "text"), "admin"),
		importRunId: withAccess(physicalField("import_run_id", "text"), "admin"),
		scopeUserId: withAccess(physicalField("scope_user_id", "text"), "admin"),
		createdAt: withAccess(physicalField("created_at", "date", false), "admin"),
		blockedReason: withAccess(physicalField("blocked_reason", "json"), "admin"),
		integrationId: withAccess(physicalField("integration_id", "text"), "admin"),
		executionId: withAccess(physicalField("execution_id", "text", false), "admin"),
		parentTriggerId: withAccess(physicalField("parent_trigger_id", "text"), "admin"),
		initiatorKind: withAccess(physicalField("initiator_kind", "text", false), "admin"),
		rootExecutionId: withAccess(physicalField("root_execution_id", "text", false), "admin"),
		providerExecutionId: withAccess(physicalField("provider_execution_id", "text"), "admin"),
		kind: {
			kind: "json",
			nullable: false,
			resolve: ({ sqlAlias }) => sql.raw(automationTriggerKind(sqlAlias)),
		},
	},
};

const automationRun: CatalogTable = {
	primaryKey: ["id"],
	name: "automation_run",
	visibility: {
		admin: { type: "all" },
		user: {
			type: "owned",
			includeGlobal: false,
			pluginReadable: false,
			column: "execution_user_id",
		},
	},
	fields: {
		id: physicalField("id", "text", false),
		stage: physicalField("stage", "text", false),
		pluginId: physicalField("plugin_id", "text"),
		status: physicalField("status", "text", false),
		startedAt: physicalField("started_at", "date"),
		skipReason: physicalField("skip_reason", "json"),
		finishedAt: physicalField("finished_at", "date"),
		delivery: physicalField("delivery", "text", false),
		hookSlug: physicalField("hook_slug", "text", false),
		hookName: physicalField("hook_name", "text", false),
		queuedAt: physicalField("queued_at", "date", false),
		triggerId: physicalField("trigger_id", "text", false),
		nextAttemptAt: physicalField("next_attempt_at", "date"),
		historyPayload: physicalField("history_payload", "json"),
		executionUserId: physicalField("execution_user_id", "text"),
		pluginRevisionId: physicalField("plugin_revision_id", "text"),
		attemptCount: physicalField("attempt_count", "number", false),
		artifactsExpireAt: physicalField("artifacts_expire_at", "date", false),
		retryPolicy: withAccess(physicalField("retry_policy", "json"), "admin"),
		scriptSlug: withAccess(physicalField("script_slug", "text", false), "admin"),
		sandboxScriptId: withAccess(physicalField("sandbox_script_id", "text"), "admin"),
		historyPayloadTruncated: physicalField("history_payload_truncated", "boolean", false),
		scriptContentHash: withAccess(physicalField("script_content_hash", "text", false), "admin"),
		pluginConfigRevisionId: withAccess(physicalField("plugin_config_revision_id", "text"), "admin"),
		retryEligibility: {
			kind: "json",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql`jsonb_build_object('reason', ${automationRunRetryEligibility(sqlAlias, sql`statement_timestamp()`)})`,
		},
		pluginName: {
			kind: "text",
			nullable: true,
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(SELECT revision.manifest -> 'metadata' ->> 'name' FROM plugin_revision revision WHERE revision.id = ${sqlAlias}.plugin_revision_id)`,
				),
		},
		triggerKind: {
			kind: "json",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(SELECT ${automationTriggerKind("run_trigger")} FROM automation_trigger run_trigger WHERE run_trigger.id = ${sqlAlias}.trigger_id)`,
				),
		},
	},
};

const automationRunAttempt: CatalogTable = {
	primaryKey: ["id"],
	name: "automation_run_attempt",
	visibility: {
		admin: { type: "all" },
		user: {
			column: "run_id",
			parentColumn: "id",
			type: "parentOwned",
			pluginReadable: false,
			parentTable: "automation_run",
			parentOwnerColumn: "execution_user_id",
		},
	},
	fields: {
		id: physicalField("id", "text", false),
		timing: physicalField("timing", "json"),
		runId: physicalField("run_id", "text", false),
		status: physicalField("status", "text", false),
		finishedAt: physicalField("finished_at", "date"),
		failureKind: physicalField("failure_kind", "text"),
		historyLogs: physicalField("history_logs", "json"),
		historyError: physicalField("history_error", "json"),
		startedAt: physicalField("started_at", "date", false),
		retryable: physicalField("retryable", "boolean", false),
		logs: withAccess(physicalField("logs", "json"), "admin"),
		error: withAccess(physicalField("error", "json"), "admin"),
		artifactsPrunedAt: physicalField("artifacts_pruned_at", "date"),
		attemptNumber: physicalField("attempt_number", "number", false),
		historyArtifactsTruncated: physicalField("history_artifacts_truncated", "boolean", false),
		workflowExecutionId: withAccess(physicalField("workflow_execution_id", "text", false), "admin"),
	},
};

const entityTranslation: CatalogTable = {
	primaryKey: ["id"],
	name: "entity_translation",
	visibility: { admin: { type: "all" } },
	fields: {
		name: physicalField("name", "text"),
		id: physicalField("id", "text", false),
		properties: physicalField("properties", "json"),
		populatedAt: physicalField("populated_at", "date"),
		language: physicalField("language", "text", false),
		entityId: physicalField("entity_id", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
	},
};

const sandboxScript: CatalogTable = {
	primaryKey: ["id"],
	name: "sandbox_script",
	visibility: { admin: { type: "all" } },
	fields: {
		id: physicalField("id", "text", false),
		slug: physicalField("slug", "text", false),
		name: physicalField("name", "text", false),
		providerId: physicalField("provider_id", "text"),
		metadata: physicalField("metadata", "json", false),
		createdAt: physicalField("created_at", "date", false),
		contentHash: physicalField("content_hash", "text", false),
		pluginRevisionId: physicalField("plugin_revision_id", "text"),
		compiledFormat: physicalField("compiled_format", "number", false),
	},
};

const userLifecycleOperation: CatalogTable = {
	primaryKey: ["id"],
	name: "user_lifecycle_operation",
	visibility: { admin: { type: "all" } },
	fields: {
		id: physicalField("id", "text", false),
		failure: physicalField("failure", "json"),
		kind: physicalField("kind", "text", false),
		startedAt: physicalField("started_at", "date"),
		status: physicalField("status", "text", false),
		userId: physicalField("user_id", "text", false),
		finishedAt: physicalField("finished_at", "date"),
		resetResult: physicalField("reset_result", "json"),
		createdAt: physicalField("created_at", "date", false),
	},
};

const migrationReportDetail: CatalogTable = {
	primaryKey: ["seq"],
	name: "migration_report_detail",
	visibility: { admin: { type: "all" } },
	fields: {
		seq: physicalField("seq", "number", false),
		detail: physicalField("detail", "json", false),
		createdAt: physicalField("created_at", "date", false),
		reportSeq: physicalField("report_seq", "number", false),
	},
};

const automationTriggerRecipient: CatalogTable = {
	primaryKey: ["triggerId", "userId"],
	name: "automation_trigger_recipient",
	visibility: { admin: { type: "all" } },
	fields: {
		userId: physicalField("user_id", "text", false),
		triggerId: physicalField("trigger_id", "text", false),
	},
};

const migrationReportTotalDetails: CatalogField = {
	kind: "number",
	nullable: true,
	resolve: ({ sqlAlias }) =>
		sql.raw(`CASE WHEN ${sqlAlias}.code IS NULL THEN NULL ELSE COALESCE(${sqlAlias}.count, 0) END`),
};

const migrationReport: CatalogTable = {
	primaryKey: ["seq"],
	name: "migration_report",
	visibility: { admin: { type: "all" } },
	fields: {
		code: physicalField("code", "text"),
		count: physicalField("count", "number"),
		totalDetails: migrationReportTotalDetails,
		seq: physicalField("seq", "number", false),
		level: physicalField("level", "text", false),
		phase: physicalField("phase", "text", false),
		message: physicalField("message", "text", false),
		createdAt: physicalField("created_at", "date", false),
		elapsedSeconds: physicalField("elapsed_seconds", "number"),
	},
};

const tables: Readonly<Record<string, CatalogTable>> = {
	user,
	event,
	entity,
	plugin,
	backupRun,
	importRun,
	savedView,
	eventSchema,
	integration,
	entitySchema,
	importSource,
	relationship,
	signalSchema,
	sandboxScript,
	automationRun,
	migrationReport,
	sandboxProvider,
	importRunFailure,
	automationTrigger,
	entityTranslation,
	pluginInstallation,
	relationshipSchema,
	integrationProvider,
	notificationChannel,
	automationRunAttempt,
	migrationReportDetail,
	userLifecycleOperation,
	sandboxProviderOperation,
	notificationSubscription,
	automationTriggerRecipient,
};

export const getCatalogTable = (name: string) =>
	Object.hasOwn(tables, name) ? tables[name] : undefined;

export const canAccessCatalogTable = (table: CatalogTable, access: RyotQLAccess) => {
	if (access.type === "admin") {
		return table.visibility.admin !== undefined;
	}
	if (access.type === "plugin") {
		return table.visibility.plugin !== undefined;
	}
	const policy = table.visibility.user;
	return (
		policy !== undefined &&
		(access.audience === "kernel" || policy.pluginReadable) &&
		(access.accessClass !== "demo" || policy.demoReadable !== false)
	);
};

const canAccessCatalogField = (field: CatalogField, access: RyotQLAccess) =>
	(access.type !== "user" || access.accessClass !== "demo" || field.demoReadable !== false) &&
	(field.access === undefined ||
		access.type === "admin" ||
		(field.access === "kernel" && access.type === "user" && access.audience === "kernel"));

export const resolveCatalogField = (table: CatalogTable, name: string, access: RyotQLAccess) => {
	const field = Object.hasOwn(table.fields, name) ? table.fields[name] : undefined;
	return field && canAccessCatalogField(field, access) ? field : undefined;
};

export const expandCatalogSelections = (
	selections: readonly RowSelection[],
	resolveTable: (alias: string) => CatalogTable | undefined,
	access: RyotQLAccess,
): ExpandedCatalogSelections => {
	const fields: FieldSelection[] = [];
	for (const selection of selections) {
		if ("key" in selection) {
			fields.push(selection);
			continue;
		}
		const table = resolveTable(selection.tableAlias);
		if (!table) {
			return { fields: [], error: `Unknown table alias '${selection.tableAlias}'` };
		}
		for (const [field, definition] of Object.entries(table.fields)) {
			if (canAccessCatalogField(definition, access)) {
				fields.push({
					key: field,
					expr: { field, type: "column", tableAlias: selection.tableAlias },
				});
			}
		}
	}
	return { fields, error: null };
};
