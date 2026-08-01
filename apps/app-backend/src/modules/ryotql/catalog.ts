import type { FieldSelection, RowSelection } from "@ryot/contract/modules/ryotql/language";
import { sql } from "drizzle-orm";

export type CatalogFieldKind = "boolean" | "date" | "json" | "number" | "text";

export type CatalogFieldContext = {
	readonly sqlAlias: string;
	readonly language: string | null;
};

export type CatalogField = {
	readonly kind: CatalogFieldKind;
	readonly nullable: boolean;
	readonly resolve: (context: CatalogFieldContext) => ReturnType<typeof sql>;
};

export type CatalogVisibility =
	| { readonly user: { readonly type: "public" } }
	| {
			readonly user:
				| { readonly type: "effectivePlugin"; readonly pluginColumn: string }
				| { readonly type: "effectiveProviderPlugin"; readonly providerColumn: string };
	  }
	| {
			readonly user: {
				readonly type: "owned";
				readonly column: string;
				readonly includeGlobal: boolean;
			};
			readonly plugin?:
				| { readonly type: "eventDefinition" }
				| {
						readonly column: string;
						readonly globalOnly: boolean;
						readonly type: "discriminator";
						readonly ownership: "entitySchemaSlugs" | "relationshipSchemaSlugs";
				  };
	  }
	| {
			readonly user: {
				readonly column: string;
				readonly type: "parentOwned";
				readonly parentTable: string;
				readonly parentColumn: string;
				readonly parentOwnerColumn: string;
			};
	  };

export type RyotQLExecutionScope =
	| { readonly type: "user"; readonly userId: string; readonly language: string | null }
	| {
			readonly type: "plugin";
			readonly pluginSlug: string;
			readonly entitySchemaSlugs: readonly string[];
			readonly relationshipSchemaSlugs: readonly string[];
			readonly eventSchemas: readonly {
				readonly eventSchemaSlug: string;
				readonly entitySchemaSlug: string;
			}[];
	  };

export type CatalogTable = {
	readonly name: string;
	readonly primaryKey: string;
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
	resolve: ({ sqlAlias }) => sql.raw(`${sqlAlias}.${column}`),
});

const pluginMetadataField = (key: "icon" | "name"): CatalogField => ({
	kind: "text",
	nullable: false,
	resolve: ({ sqlAlias }) => sql.raw(`${sqlAlias}.manifest -> 'metadata' ->> '${key}'`),
});

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

const entity: CatalogTable = {
	name: "entity",
	primaryKey: "id",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: true },
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
		translationStatus: entityTranslationStatus,
		userId: physicalField("user_id", "text"),
		id: physicalField("id", "text", false),
		externalId: physicalField("external_id", "text"),
		providerId: physicalField("provider_id", "text"),
		populatedAt: physicalField("populated_at", "date"),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		entitySchemaSlug: physicalField("entity_schema_slug", "text", false),
	},
};

const event: CatalogTable = {
	name: "event",
	primaryKey: "id",
	visibility: {
		plugin: { type: "eventDefinition" },
		user: { type: "owned", column: "user_id", includeGlobal: false },
	},
	fields: {
		id: physicalField("id", "text", false),
		userId: physicalField("user_id", "text", false),
		sessionEntityId: physicalField("session_entity_id", "text"),
		entityId: physicalField("entity_id", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		properties: physicalField("properties", "json", false),
		occurredAt: physicalField("occurred_at", "date", false),
		eventSchemaSlug: physicalField("event_schema_slug", "text", false),
	},
};

const relationship: CatalogTable = {
	primaryKey: "id",
	name: "relationship",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: true },
		plugin: {
			globalOnly: false,
			type: "discriminator",
			column: "relationship_schema_slug",
			ownership: "relationshipSchemaSlugs",
		},
	},
	fields: {
		userId: physicalField("user_id", "text"),
		id: physicalField("id", "text", false),
		createdAt: physicalField("created_at", "date", false),
		properties: physicalField("properties", "json", false),
		sourceEntityId: physicalField("source_entity_id", "text", false),
		targetEntityId: physicalField("target_entity_id", "text", false),
		relationshipSchemaSlug: physicalField("relationship_schema_slug", "text", false),
	},
};

const plugin: CatalogTable = {
	name: "plugin",
	primaryKey: "id",
	visibility: { user: { type: "owned", column: "owner_id", includeGlobal: true } },
	fields: {
		icon: pluginMetadataField("icon"),
		name: pluginMetadataField("name"),
		id: physicalField("id", "text", false),
		slug: physicalField("slug", "text", false),
		scope: physicalField("scope", "text", false),
		status: physicalField("status", "text", false),
		version: physicalField("version", "text", false),
		ingestedAt: physicalField("ingested_at", "date", false),
	},
};

const pluginInstallation: CatalogTable = {
	primaryKey: "id",
	name: "plugin_installation",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: physicalField("id", "text", false),
		health: physicalField("health", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		pluginId: physicalField("plugin_id", "text", false),
		sortOrder: physicalField("sort_order", "number", false),
		isDisabled: physicalField("is_disabled", "boolean", false),
	},
};

const sandboxProvider: CatalogTable = {
	primaryKey: "id",
	name: "sandbox_provider",
	visibility: { user: { type: "effectivePlugin", pluginColumn: "plugin_id" } },
	fields: {
		id: physicalField("id", "text", false),
		slug: physicalField("slug", "text", false),
		name: physicalField("name", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		pluginId: physicalField("plugin_id", "text", false),
		information: physicalField("information", "json", false),
		rootEntitySchemaSlug: physicalField("root_entity_schema_slug", "text", false),
	},
};

const sandboxProviderOperation: CatalogTable = {
	primaryKey: "id",
	name: "sandbox_provider_operation",
	visibility: { user: { type: "effectiveProviderPlugin", providerColumn: "provider_id" } },
	fields: {
		id: physicalField("id", "text", false),
		optionsSchema: physicalField("options_schema", "json"),
		operation: physicalField("operation", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		providerId: physicalField("provider_id", "text", false),
	},
};

const savedView: CatalogTable = {
	primaryKey: "id",
	name: "saved_view",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: physicalField("id", "text", false),
		pluginSlug: physicalField("plugin_slug", "text"),
		slug: physicalField("slug", "text", false),
		name: physicalField("name", "text", false),
		icon: physicalField("icon", "text", false),
		layouts: physicalField("layouts", "json", false),
		entitySchemaSlug: physicalField("entity_schema_slug", "text"),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		sortOrder: physicalField("sort_order", "number", false),
		isBuiltin: physicalField("is_builtin", "boolean", false),
		isDisabled: physicalField("is_disabled", "boolean", false),
	},
};

const notificationChannel: CatalogTable = {
	primaryKey: "id",
	name: "notification_channel",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: physicalField("id", "text", false),
		channel: physicalField("platform", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		description: physicalField("description", "text", false),
		isDisabled: physicalField("is_disabled", "boolean", false),
	},
};

const notificationSubscriptionState: CatalogTable = {
	primaryKey: "id",
	name: "notification_subscription_state",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: physicalField("id", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		isActive: physicalField("is_active", "boolean", false),
		signalSchemaSlug: physicalField("signal_schema_slug", "text", false),
	},
};

const integration: CatalogTable = {
	primaryKey: "id",
	name: "integration",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		name: physicalField("name", "text"),
		id: physicalField("id", "text", false),
		lot: physicalField("lot", "text", false),
		lastFinishedAt: physicalField("last_finished_at", "date"),
		provider: physicalField("provider", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		pluginSlug: physicalField("plugin_slug", "text", false),
		isDisabled: physicalField("is_disabled", "boolean", false),
		extraSettings: physicalField("extra_settings", "json", false),
		syncOwnership: physicalField("sync_ownership", "boolean", false),
		minimumProgress: physicalField("minimum_progress", "number", false),
		maximumProgress: physicalField("maximum_progress", "number", false),
	},
};

const importRun: CatalogTable = {
	name: "import_run",
	primaryKey: "id",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		startedAt: physicalField("started_at", "date"),
		finishedAt: physicalField("finished_at", "date"),
		id: physicalField("id", "text", false),
		totalItems: physicalField("total_items", "number"),
		failureReason: physicalField("failure_reason", "json"),
		integrationId: physicalField("integration_id", "text"),
		source: physicalField("source", "text", false),
		status: physicalField("status", "text", false),
		progress: physicalField("progress", "number", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		failedItems: physicalField("failed_items", "number", false),
		inputSummary: physicalField("input_summary", "json", false),
		importedItems: physicalField("imported_items", "number", false),
		processedItems: physicalField("processed_items", "number", false),
	},
};

const importRunFailure: CatalogTable = {
	primaryKey: "id",
	name: "import_run_failure",
	visibility: {
		user: {
			column: "run_id",
			parentColumn: "id",
			type: "parentOwned",
			parentTable: "import_run",
			parentOwnerColumn: "user_id",
		},
	},
	fields: {
		id: physicalField("id", "text", false),
		sourceLabel: physicalField("source_label", "text"),
		stage: physicalField("stage", "text", false),
		runId: physicalField("run_id", "text", false),
		reason: physicalField("reason", "json", false),
		eventSchemaSlug: physicalField("event_schema_slug", "text"),
		sourceIdentifier: physicalField("source_identifier", "text"),
		entitySchemaSlug: physicalField("entity_schema_slug", "text"),
		createdAt: physicalField("created_at", "date", false),
		itemIndex: physicalField("item_index", "number", false),
	},
};

const tables: Readonly<Record<string, CatalogTable>> = {
	event,
	entity,
	plugin,
	importRun,
	savedView,
	integration,
	relationship,
	sandboxProvider,
	importRunFailure,
	pluginInstallation,
	notificationChannel,
	sandboxProviderOperation,
	notificationSubscriptionState,
};

export const getCatalogTable = (name: string) => tables[name];

export const canAccessCatalogTable = (
	table: CatalogTable,
	scope: Pick<RyotQLExecutionScope, "type">,
) => scope.type === "user" || "plugin" in table.visibility;

export const resolveCatalogField = (table: CatalogTable, name: string) => table.fields[name];

export const expandCatalogSelections = (
	selections: readonly RowSelection[],
	resolveTable: (alias: string) => CatalogTable | undefined,
): ExpandedCatalogSelections => {
	const fields: FieldSelection[] = [];
	for (const selection of selections) {
		if ("key" in selection) {
			fields.push(selection);
			continue;
		}
		const table = resolveTable(selection.tableAlias);
		if (!table) {
			return { error: `Unknown table alias '${selection.tableAlias}'`, fields: [] };
		}
		for (const field of Object.keys(table.fields)) {
			fields.push({
				key: field,
				expr: { field, tableAlias: selection.tableAlias, type: "column" },
			});
		}
	}
	return { error: null, fields };
};
