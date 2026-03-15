import type { FieldSelection, RowSelection } from "@ryot/contract/modules/ryotql/language";
import { sql } from "drizzle-orm";

export type CatalogFieldKind = "boolean" | "date" | "json" | "number" | "text";

export type CatalogFieldContext = {
	readonly sqlAlias: string;
	readonly language: string | null;
};

export type CatalogField = {
	readonly kind: CatalogFieldKind;
	readonly resolve: (context: CatalogFieldContext) => ReturnType<typeof sql>;
};

export type CatalogVisibility =
	| { readonly user: { readonly type: "public" } }
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

const physicalField = (column: string, kind: CatalogFieldKind): CatalogField => ({
	kind,
	resolve: ({ sqlAlias }) => sql.raw(`${sqlAlias}.${column}`),
});

const localizedEntityName: CatalogField = {
	kind: "text",
	resolve: ({ language, sqlAlias }) =>
		language === null
			? sql.raw(`${sqlAlias}.name`)
			: sql`COALESCE((SELECT translation.name FROM entity_translation translation WHERE translation.entity_id = ${sql.raw(`${sqlAlias}.id`)} AND translation.language = ${language}), ${sql.raw(`${sqlAlias}.name`)})`,
};

const localizedEntityProperties: CatalogField = {
	kind: "json",
	resolve: ({ language, sqlAlias }) =>
		language === null
			? sql.raw(`${sqlAlias}.properties`)
			: sql`${sql.raw(`${sqlAlias}.properties`)} || COALESCE((SELECT translation.properties FROM entity_translation translation WHERE translation.entity_id = ${sql.raw(`${sqlAlias}.id`)} AND translation.language = ${language}), '{}'::jsonb)`,
};

const entityTranslationStatus: CatalogField = {
	kind: "text",
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
		id: physicalField("id", "text"),
		userId: physicalField("user_id", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		externalId: physicalField("external_id", "text"),
		providerId: physicalField("provider_id", "text"),
		populatedAt: physicalField("populated_at", "date"),
		entitySchemaSlug: physicalField("entity_schema_slug", "text"),
	},
};

const event: CatalogTable = {
	name: "event",
	primaryKey: "id",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: true },
		plugin: { type: "eventDefinition" },
	},
	fields: {
		id: physicalField("id", "text"),
		userId: physicalField("user_id", "text"),
		entityId: physicalField("entity_id", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		properties: physicalField("properties", "json"),
		occurredAt: physicalField("occurred_at", "date"),
		eventSchemaSlug: physicalField("event_schema_slug", "text"),
		sessionEntityId: physicalField("session_entity_id", "text"),
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
		id: physicalField("id", "text"),
		userId: physicalField("user_id", "text"),
		createdAt: physicalField("created_at", "date"),
		properties: physicalField("properties", "json"),
		sourceEntityId: physicalField("source_entity_id", "text"),
		targetEntityId: physicalField("target_entity_id", "text"),
		relationshipSchemaSlug: physicalField("relationship_schema_slug", "text"),
	},
};

const plugin: CatalogTable = {
	name: "plugin",
	primaryKey: "slug",
	visibility: { user: { type: "public" } },
	fields: {
		slug: physicalField("slug", "text"),
		status: physicalField("status", "text"),
		version: physicalField("version", "text"),
		manifest: physicalField("manifest", "json"),
		ingestedAt: physicalField("ingested_at", "date"),
	},
};

const pluginState: CatalogTable = {
	primaryKey: "id",
	name: "plugin_state",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: physicalField("id", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		pluginSlug: physicalField("plugin_slug", "text"),
		sortOrder: physicalField("sort_order", "number"),
		isDisabled: physicalField("is_disabled", "boolean"),
	},
};

const savedView: CatalogTable = {
	primaryKey: "id",
	name: "saved_view",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: physicalField("id", "text"),
		slug: physicalField("slug", "text"),
		name: physicalField("name", "text"),
		icon: physicalField("icon", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		sortOrder: physicalField("sort_order", "number"),
		pluginSlug: physicalField("plugin_slug", "text"),
		isBuiltin: physicalField("is_builtin", "boolean"),
		isDisabled: physicalField("is_disabled", "boolean"),
		queryDocument: physicalField("query_document", "json"),
		displayConfiguration: physicalField("display_configuration", "json"),
	},
};

const notificationChannel: CatalogTable = {
	primaryKey: "id",
	name: "notification_channel",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: physicalField("id", "text"),
		channel: physicalField("platform", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		description: physicalField("description", "text"),
		isDisabled: physicalField("is_disabled", "boolean"),
	},
};

const notificationSubscriptionState: CatalogTable = {
	primaryKey: "id",
	name: "notification_subscription_state",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: physicalField("id", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		isActive: physicalField("is_active", "boolean"),
		signalSchemaSlug: physicalField("signal_schema_slug", "text"),
	},
};

const integration: CatalogTable = {
	primaryKey: "id",
	name: "integration",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: physicalField("id", "text"),
		lot: physicalField("lot", "text"),
		name: physicalField("name", "text"),
		provider: physicalField("provider", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		pluginSlug: physicalField("plugin_slug", "text"),
		isDisabled: physicalField("is_disabled", "boolean"),
		extraSettings: physicalField("extra_settings", "json"),
		lastFinishedAt: physicalField("last_finished_at", "date"),
		syncOwnership: physicalField("sync_ownership", "boolean"),
		minimumProgress: physicalField("minimum_progress", "number"),
		maximumProgress: physicalField("maximum_progress", "number"),
	},
};

const importRun: CatalogTable = {
	name: "import_run",
	primaryKey: "id",
	visibility: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: physicalField("id", "text"),
		source: physicalField("source", "text"),
		status: physicalField("status", "text"),
		progress: physicalField("progress", "number"),
		totalItems: physicalField("total_items", "number"),
		failedItems: physicalField("failed_items", "number"),
		importedItems: physicalField("imported_items", "number"),
		processedItems: physicalField("processed_items", "number"),
		errorSummary: physicalField("error_summary", "text"),
		inputSummary: physicalField("input_summary", "json"),
		integrationId: physicalField("integration_id", "text"),
		startedAt: physicalField("started_at", "date"),
		finishedAt: physicalField("finished_at", "date"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
	},
};

const importRunFailure: CatalogTable = {
	name: "import_run_failure",
	primaryKey: "id",
	visibility: {
		user: {
			type: "parentOwned",
			column: "run_id",
			parentTable: "import_run",
			parentColumn: "id",
			parentOwnerColumn: "user_id",
		},
	},
	fields: {
		id: physicalField("id", "text"),
		runId: physicalField("run_id", "text"),
		stage: physicalField("stage", "text"),
		message: physicalField("message", "text"),
		context: physicalField("context", "json"),
		itemIndex: physicalField("item_index", "number"),
		sourceLabel: physicalField("source_label", "text"),
		sourceIdentifier: physicalField("source_identifier", "text"),
		eventSchemaSlug: physicalField("event_schema_slug", "text"),
		entitySchemaSlug: physicalField("entity_schema_slug", "text"),
		createdAt: physicalField("created_at", "date"),
	},
};

const tables: Readonly<Record<string, CatalogTable>> = {
	event,
	entity,
	plugin,
	importRun,
	savedView,
	integration,
	pluginState,
	relationship,
	importRunFailure,
	notificationChannel,
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
