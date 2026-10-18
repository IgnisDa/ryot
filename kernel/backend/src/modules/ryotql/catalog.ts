import type { FieldSelection, RowSelection } from "@ryot-app/contract/modules/ryotql/language";
import { KernelSavedViewRendererName } from "@ryot-app/contract/modules/saved-views/schemas";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { sql } from "drizzle-orm";

import { automationRunRetryEligibility } from "#modules/automations/retry-eligibility";
import type { DefinitionReadContext } from "#modules/definitions/read-context";
import { ingestionReadinessMetadataSql } from "#modules/plugins/catalog/readiness-projection";
import type { ScriptPluginRevision } from "#modules/scripts/authorization/principal";

import { ingestionActivitiesSql, ingestionSummarySql } from "./ingestion-projection";

export type RyotQLAudience = "kernel" | "plugin";

export type CatalogFieldKind = "date" | "json" | "text" | "number" | "boolean";

export type RyotQLExecutionScope =
	UserExecutionScope | PluginExecutionScope | { readonly type: "admin" };

export type RyotQLAccess =
	| { readonly type: "admin" }
	| Pick<PluginExecutionScope, "type">
	| Pick<UserExecutionScope, "type" | "audience" | "accessClass">;

export type CatalogField = {
	readonly nullable: boolean;
	readonly demoReadable?: false;
	readonly kind: CatalogFieldKind;
	readonly access?: "admin" | "kernel";
	readonly resolve: (context: CatalogFieldContext) => ReturnType<typeof sql>;
};

export type CatalogTable = {
	readonly name: string;
	readonly visibility: CatalogVisibility;
	// Small per-user catalogs: an include reads one materialized copy instead of re-evaluating the
	// view for every parent row.
	readonly materializedInIncludes?: true;
	readonly primaryKey: readonly [string, ...string[]];
	readonly fields: Readonly<Record<string, CatalogField>>;
};

type ExpandedCatalogSelections = {
	readonly error: null | string;
	readonly fields: FieldSelection[];
};

type CatalogFieldContext = {
	readonly sqlAlias: string;
	readonly userId?: null | string;
	readonly language: null | string;
};

type PluginExecutionScope = ScriptPluginRevision["schemaScope"] & {
	readonly type: "plugin";
	readonly pluginId: ScriptPluginRevision["id"];
	readonly pluginRevisionId: ScriptPluginRevision["revisionId"];
};

type UserExecutionScope = {
	readonly type: "user";
	readonly userId: string;
	readonly language: null | string;
	readonly audience: RyotQLAudience;
	readonly accessClass: AccessClass;
	readonly definitionContext?: undefined | DefinitionReadContext;
};

type CatalogUserPolicy =
	| { readonly type: "public" }
	| { readonly type: "self"; readonly column: string }
	| {
			readonly type: "owned";
			readonly column: string;
			readonly where?: string;
			readonly includeGlobal: boolean;
	  }
	| {
			readonly column: string;
			readonly type: "parentOwned";
			readonly parentTable: string;
			readonly parentColumn: string;
			readonly parentOwnerColumn: string;
	  };

type CatalogVisibility = {
	readonly admin?: { readonly type: "all" };
	readonly user?: CatalogUserPolicy & {
		readonly demoReadable?: false;
		readonly pluginReadable: boolean;
	};
	readonly plugin?:
		| { readonly type: "eventDefinition" }
		| {
				readonly type: "schemaDefinition";
				readonly kind: "event" | "entity" | "signal" | "relationship";
		  }
		| {
				readonly column: string;
				readonly ownerColumn: string;
				readonly globalOnly: boolean;
				readonly type: "discriminator";
				readonly ownership: "entitySchemaSlugs" | "relationshipSchemaSlugs";
		  };
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

const installationPackageId: CatalogField = {
	kind: "text",
	nullable: true,
	resolve: ({ sqlAlias }) =>
		sql.raw(
			`(SELECT plugin.package_id FROM plugin_installation installation INNER JOIN plugin ON plugin.id = installation.plugin_id WHERE installation.id = ${sqlAlias}.plugin_installation_id)`,
		),
};

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

const pluginMetadataField = (key: "icon" | "name" | "description"): CatalogField =>
	pluginActiveRevisionField(`revision.${key}`, "text", true);

const pluginClientApiVersion = pluginActiveRevisionField(
	`(revision.client ->> 'apiVersion')::int`,
	"number",
	true,
);

const localizedEntityName: CatalogField = {
	kind: "text",
	nullable: false,
	resolve: ({ language, sqlAlias }) =>
		language === null
			? sql.raw(`${sqlAlias}.name`)
			: sql`COALESCE((SELECT translation.name FROM entity_translation translation WHERE translation.entity_id = ${sql.raw(`${sqlAlias}.id`)} AND translation.language = ${language} AND translation.source_content_generation = ${sql.raw(`${sqlAlias}.content_generation`)}), ${sql.raw(`${sqlAlias}.name`)})`,
};

const localizedEntityProperties: CatalogField = {
	kind: "json",
	nullable: false,
	resolve: ({ language, sqlAlias }) =>
		language === null
			? sql.raw(`${sqlAlias}.properties`)
			: sql`${sql.raw(`${sqlAlias}.properties`)} || COALESCE((SELECT translation.properties FROM entity_translation translation WHERE translation.entity_id = ${sql.raw(`${sqlAlias}.id`)} AND translation.language = ${language} AND translation.source_content_generation = ${sql.raw(`${sqlAlias}.content_generation`)}), '{}'::jsonb)`,
};

const enrichmentWorkState = (
	context: CatalogFieldContext,
	operation: "population" | "translation",
	related = false,
) => {
	const id = sql.raw(`${context.sqlAlias}.id`);
	const providerId = sql.raw(`${context.sqlAlias}.provider_id`);
	const externalId = sql.raw(`${context.sqlAlias}.external_id`);
	const schemaSlug = sql.raw(`${context.sqlAlias}.entity_schema_slug`);
	const pluginId = sql.raw(`${context.sqlAlias}.entity_schema_plugin_id`);
	const scopeUserId = sql.raw(`${context.sqlAlias}.user_id`);
	return sql`coalesce((select coalesce(shared.state, request.state) from entity_enrichment_request request
		left join entity_enrichment_request shared on shared.id = request.joined_to
		where (request.entity_id = ${id} or (request.entity_id is null and request.provider_id = ${providerId} and request.external_id = ${externalId} and request.entity_schema_slug = ${schemaSlug} and request.plugin_id = ${pluginId} and request.scope_user_id is not distinct from ${scopeUserId}))
		and request.operation = ${operation}
		and (${related} = false or request.level = 'full')
		and (${operation} <> 'translation' or request.language = ${context.language})
		and (${operation} <> 'translation' or request.source_content_generation = ${sql.raw(`${context.sqlAlias}.content_generation`)})
		and request.requester_user_id is not distinct from ${context.userId ?? null}
		and request.requester_generation is not distinct from (select account_generation from "user" where id = ${context.userId ?? null})
		order by request.sequence desc limit 1), 'idle')`;
};

const entityTranslationStatus: CatalogField = {
	kind: "json",
	nullable: false,
	resolve: (context) => {
		const { language, sqlAlias } = context;
		if (language === null) {
			return sql`jsonb_build_object('availability', 'none', 'state', 'idle')`;
		}
		const id = sql.raw(`${sqlAlias}.id`);
		const providerId = sql.raw(`${sqlAlias}.provider_id`);
		const populatedAt = sql.raw(`${sqlAlias}.populated_at`);
		const canonicalLanguage = sql`(SELECT provider.information ->> 'canonicalLanguage' FROM sandbox_provider provider WHERE provider.id = ${providerId})`;
		const sourceGeneration = sql.raw(`${sqlAlias}.content_generation`);
		const supported = sql`exists (select 1 from sandbox_provider provider
			join plugin owner on owner.id = provider.plugin_id
			join definition_provider_operation operation on operation.plugin_revision_id = owner.active_revision_id and operation.provider_slug = provider.slug and operation.operation = 'translate'
			join sandbox_script script on script.plugin_revision_id = operation.plugin_revision_id and script.slug = operation.script_slug and script.provider_id = provider.id
			where provider.id = ${providerId} and script.metadata -> 'translationInputs' ? ${sql.raw(`${sqlAlias}.entity_schema_slug`)})`;
		const applicable = sql`${providerId} is not null and ${canonicalLanguage} is not null and ${canonicalLanguage} <> ${language} and ${populatedAt} is not null and ${supported}`;
		const availability = sql`CASE
			WHEN ${providerId} IS NULL THEN 'none'
			WHEN ${canonicalLanguage} IS NULL THEN 'none'
			WHEN ${canonicalLanguage} = ${language} THEN 'none'
			WHEN ${populatedAt} IS NULL THEN 'none'
			WHEN NOT ${supported} THEN 'none'
			WHEN NOT EXISTS (SELECT 1 FROM entity_translation translation WHERE translation.entity_id = ${id} AND translation.language = ${language} AND translation.source_content_generation = ${sourceGeneration}) THEN 'missing'
			WHEN (SELECT translation.name IS NULL AND (translation.properties IS NULL OR translation.properties = '{}'::jsonb) FROM entity_translation translation WHERE translation.entity_id = ${id} AND translation.language = ${language} AND translation.source_content_generation = ${sourceGeneration}) THEN 'none'
			ELSE 'complete'
		END`;
		return sql`jsonb_build_object('availability', ${availability}, 'state', case when ${applicable} then ${enrichmentWorkState(context, "translation")} else 'idle' end)`;
	},
};

const entityPopulationStatus: CatalogField = {
	kind: "json",
	nullable: false,
	resolve: (context) => {
		const { sqlAlias } = context;
		const providerId = sql.raw(`${sqlAlias}.provider_id`);
		const externalId = sql.raw(`${sqlAlias}.external_id`);
		const populatedAt = sql.raw(`${sqlAlias}.populated_at`);
		const availability = sql`CASE
			WHEN ${populatedAt} IS NOT NULL THEN 'complete'
			WHEN ${providerId} IS NULL OR ${externalId} IS NULL THEN 'none'
			WHEN ${sql.raw(`${sqlAlias}.properties`)} <> '{}'::jsonb THEN 'partial'
			ELSE 'missing'
		END`;
		return sql`jsonb_build_object('availability', ${availability}, 'state', ${enrichmentWorkState(context, "population")})`;
	},
};

const entityRelatedPopulationStatus: CatalogField = {
	kind: "json",
	nullable: false,
	resolve: (context) => {
		const { sqlAlias } = context;
		const providerId = sql.raw(`${sqlAlias}.provider_id`);
		const externalId = sql.raw(`${sqlAlias}.external_id`);
		const relatedPopulatedAt = sql.raw(`${sqlAlias}.related_populated_at`);
		const availability = sql`CASE
			WHEN ${relatedPopulatedAt} IS NOT NULL THEN 'complete'
			WHEN ${providerId} IS NULL OR ${externalId} IS NULL THEN 'none'
			WHEN exists (select 1 from relationship related where related.user_id is not distinct from ${sql.raw(`${sqlAlias}.user_id`)} and (related.source_entity_id = ${sql.raw(`${sqlAlias}.id`)} or related.target_entity_id = ${sql.raw(`${sqlAlias}.id`)})) THEN 'partial'
			ELSE 'missing'
		END`;
		return sql`jsonb_build_object('availability', ${availability}, 'state', ${enrichmentWorkState(context, "population", true)})`;
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
			ownerColumn: "entity_schema_plugin_id",
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
		relatedPopulationStatus: entityRelatedPopulationStatus,
		entitySchemaSlug: physicalField("entity_schema_slug", "text", false),
		entitySchemaPluginId: physicalField("entity_schema_plugin_id", "text"),
		collectionOrderRevision: physicalField("collection_order_revision", "number", false),
		providerCheckedAt: {
			kind: "date",
			nullable: true,
			resolve: ({ sqlAlias }) =>
				sql`(select max(request.base_checked_at) from entity_enrichment_request request where request.entity_id = ${sql.raw(`${sqlAlias}.id`)})`,
		},
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
		revision: physicalField("revision", "number", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		properties: physicalField("properties", "json", false),
		occurredAt: physicalField("occurred_at", "date", false),
		sessionEntityId: physicalField("session_entity_id", "text"),
		eventSchemaSlug: physicalField("event_schema_slug", "text", false),
		eventSchemaPluginId: physicalField("event_schema_plugin_id", "text"),
		orderKey: {
			kind: "text",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql`coalesce(${sql.raw(sqlAlias)}.order_key, ${sql.raw(sqlAlias)}.id)`,
		},
		orderCreatedAt: {
			kind: "date",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql`coalesce(${sql.raw(sqlAlias)}.order_created_at, ${sql.raw(sqlAlias)}.created_at)`,
		},
		projection: {
			kind: "json",
			nullable: true,
			resolve: ({ sqlAlias }) => sql`(select p.properties from event_projection p
				inner join event_stream_work w on w.id = p.stream_id
				inner join event_stream s on s.id = w.id
				inner join plugin g on g.id = s.event_schema_plugin_id
				inner join plugin_installation i on i.plugin_id = g.id and i.user_id = s.user_id
				where p.event_id = ${sql.raw(sqlAlias)}.id
				and w.completed_revision = s.revision and w.plugin_revision_id = g.active_revision_id
				and w.plugin_pin ->> 'configRevisionId' = case when g.owner_user_id is null
					then g.environment_config_revision_id else i.active_config_revision_id end
				and g.status = 'active' and i.health = 'ready' and i.uninstalled_at is null)`,
		},
		projectionStatus: {
			kind: "text",
			nullable: false,
			resolve: ({ sqlAlias }) => sql`coalesce((select case
				when w.completed_revision = s.revision then 'ready'
				when j.status = 'failed' then 'failed'
				else 'pending' end
				from event_stream s inner join event_stream_work w on w.id = s.id
				inner join plugin g on g.id = s.event_schema_plugin_id
				inner join plugin_installation i on i.plugin_id = g.id and i.user_id = s.user_id
				left join background_work j on j.id = w.current_job_id
				where s.user_id = ${sql.raw(sqlAlias)}.user_id and s.entity_id = ${sql.raw(sqlAlias)}.entity_id
				and s.event_schema_plugin_id is not distinct from ${sql.raw(sqlAlias)}.event_schema_plugin_id
				and s.event_schema_slug = ${sql.raw(sqlAlias)}.event_schema_slug
				and w.plugin_revision_id = g.active_revision_id
				and w.plugin_pin ->> 'configRevisionId' = case when g.owner_user_id is null then g.environment_config_revision_id else i.active_config_revision_id end
				and g.status = 'active' and i.health = 'ready' and i.uninstalled_at is null),
				case when exists (select 1 from user_event_schema d inner join entity e on e.id = ${sql.raw(sqlAlias)}.entity_id
					where d.user_id = ${sql.raw(sqlAlias)}.user_id and d.entity_schema_slug = e.entity_schema_slug
					and d.plugin_id is not distinct from ${sql.raw(sqlAlias)}.event_schema_plugin_id
					and d.slug = ${sql.raw(sqlAlias)}.event_schema_slug and d.is_effective and d.projection is not null)
				then 'pending' else 'none' end)`,
		},
	},
};

const eventProjection: CatalogTable = {
	primaryKey: ["eventId"],
	name: "event_projection",
	visibility: {
		user: {
			column: "event_id",
			parentColumn: "id",
			type: "parentOwned",
			pluginReadable: true,
			parentTable: "event",
			parentOwnerColumn: "user_id",
		},
	},
	fields: {
		eventId: physicalField("event_id", "text", false),
		streamId: physicalField("stream_id", "text", false),
		updatedAt: physicalField("updated_at", "date", false),
		properties: physicalField("properties", "json", false),
	},
};

const eventStream: CatalogTable = {
	primaryKey: ["id"],
	name: "event_stream",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		id: physicalField("id", "text", false),
		entityId: physicalField("entity_id", "text", false),
		revision: physicalField("revision", "number", false),
		eventSchemaSlug: physicalField("event_schema_slug", "text", false),
		eventSchemaPluginId: physicalField("event_schema_plugin_id", "text"),
	},
};

const eventScope: CatalogTable = {
	primaryKey: ["id"],
	name: "event_scope",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		id: physicalField("id", "text", false),
		entityId: physicalField("entity_id", "text", false),
		revision: physicalField("revision", "number", false),
		eventSchemaPluginId: physicalField("event_schema_plugin_id", "text"),
	},
};

const backgroundWork: CatalogTable = {
	primaryKey: ["id"],
	name: "background_work",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		error: physicalField("error", "text"),
		id: physicalField("id", "text", false),
		scope: physicalField("scope", "text", false),
		status: physicalField("status", "text", false),
		pluginId: physicalField("plugin_id", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
	},
};

const eventStreamWork: CatalogTable = {
	primaryKey: ["id"],
	name: "event_stream_work",
	fields: {
		id: physicalField("id", "text", false),
		completedRevision: physicalField("completed_revision", "number"),
	},
	visibility: {
		user: {
			column: "id",
			parentColumn: "id",
			type: "parentOwned",
			pluginReadable: true,
			parentTable: "event_stream",
			parentOwnerColumn: "user_id",
		},
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
			ownerColumn: "relationship_schema_plugin_id",
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
		relationshipSchemaPluginId: physicalField("relationship_schema_plugin_id", "text"),
		collectionRank: {
			kind: "number",
			nullable: true,
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(case when ${sqlAlias}.relationship_schema_slug = 'member-of' and ${sqlAlias}.relationship_schema_plugin_id is null then (${sqlAlias}.properties ->> 'rank')::double precision end)`,
				),
		},
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
		status: physicalField("status", "text", false),
		description: pluginMetadataField("description"),
		packageId: physicalField("package_id", "text", false),
		activationId: physicalField("activation_id", "text", false),
		activeRevisionId: physicalField("active_revision_id", "text"),
		version: pluginActiveRevisionField("revision.version", "text", true),
		ingestedAt: pluginActiveRevisionField("revision.created_at", "date", true),
		contentHash: pluginActiveRevisionField("revision.content_hash", "text", true),
		configSchema: pluginActiveRevisionField("revision.client_config_schema", "json", true),
		clientEntities: pluginActiveRevisionField("revision.client -> 'entities'", "json", true),
		userSettingsSchema: pluginActiveRevisionField("revision.user_settings_schema", "json", true),
		environmentConfigRevisionId: withAccess(
			physicalField("environment_config_revision_id", "text"),
			"admin",
		),
		scope: {
			kind: "text",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql.raw(`CASE WHEN ${sqlAlias}.owner_user_id IS NULL THEN 'system' ELSE 'user' END`),
		},
	},
};

const kernelSavedViewRendererNames = KernelSavedViewRendererName.literals
	.map((name) => `'${name}'`)
	.join(", ");

const usableHomeSavedView = (
	view: string,
	userId: string,
) => `NOT ${view}.is_hidden AND CASE ${view}.renderer ->> 'kind'
	WHEN 'kernel' THEN COALESCE(${view}.renderer ->> 'name' IN (${kernelSavedViewRendererNames}), false)
	WHEN 'plugin' THEN EXISTS (
		SELECT 1 FROM user_plugin home_renderer_plugin
		INNER JOIN plugin_revision home_renderer_revision ON home_renderer_revision.id = home_renderer_plugin.active_revision_id
		WHERE home_renderer_plugin.user_id = ${userId}
			AND home_renderer_plugin.plugin_id = ${view}.renderer ->> 'pluginId'
			AND home_renderer_plugin.health = 'ready'
			AND NOT home_renderer_plugin.is_hidden
			AND home_renderer_revision.client -> 'exports' -> (${view}.renderer ->> 'exportName') ->> 'kind' = 'page'
	)
	ELSE false
END`;

const effectiveHomeSavedView: CatalogField = {
	kind: "json",
	nullable: true,
	resolve: ({ sqlAlias }) =>
		sql.raw(`COALESCE(
			(SELECT ${sqlAlias}.home_saved_view FROM user_saved_view_effective home_selected
				WHERE CASE ${sqlAlias}.home_saved_view ->> 'kind'
					WHEN 'custom' THEN NOT home_selected.is_builtin AND home_selected.id = ${sqlAlias}.home_saved_view ->> 'savedViewId'
					WHEN 'kernel' THEN home_selected.is_builtin AND home_selected.plugin_id IS NULL AND home_selected.slug = ${sqlAlias}.home_saved_view ->> 'slug'
					WHEN 'plugin' THEN home_selected.is_builtin AND home_selected.plugin_id = ${sqlAlias}.home_saved_view ->> 'pluginId' AND home_selected.slug = ${sqlAlias}.home_saved_view ->> 'slug'
					ELSE false END
					AND home_selected.user_id = ${sqlAlias}.user_id
					AND ${usableHomeSavedView("home_selected", `${sqlAlias}.user_id`)}),
			(SELECT jsonb_build_object('kind', 'plugin', 'pluginId', home_plugin.id, 'slug', home_fallback.slug) FROM plugin home_plugin
				INNER JOIN plugin_revision home_revision ON home_revision.id = home_plugin.active_revision_id
				INNER JOIN user_saved_view_effective home_fallback ON home_fallback.slug = home_revision.client ->> 'homeView'
				WHERE home_plugin.id = ${sqlAlias}.plugin_id
					AND home_plugin.status = 'active'
					AND (home_plugin.owner_user_id IS NULL OR home_plugin.owner_user_id = ${sqlAlias}.user_id)
					AND home_fallback.user_id = ${sqlAlias}.user_id
					AND home_fallback.is_builtin
					AND home_fallback.plugin_id = home_plugin.id
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
		homeSavedView: effectiveHomeSavedView,
		id: physicalField("id", "text", false),
		health: physicalField("health", "text", false),
		pluginId: physicalField("plugin_id", "text", false),
		healthReason: physicalField("health_reason", "text"),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		isHidden: physicalField("is_hidden", "boolean", false),
		sortOrder: physicalField("sort_order", "number", false),
		isInitialized: physicalField("is_initialized", "boolean", false),
		incompatibilityReason: physicalField("incompatibility_reason", "text"),
		config: withAccess(physicalField("client_config", "json", false), "kernel"),
		userSettings: withAccess(physicalField("user_settings", "json", false), "kernel"),
		configuredSecrets: withAccess(textArrayField("configured_secret_paths"), "kernel"),
		activeConfigRevisionId: withAccess(physicalField("active_config_revision_id", "text"), "admin"),
		conflictingSystemPluginId: {
			kind: "text",
			nullable: true,
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(SELECT system_plugin.id FROM plugin private_plugin JOIN plugin system_plugin ON system_plugin.package_id = private_plugin.package_id AND system_plugin.owner_user_id IS NULL AND system_plugin.status = 'active' WHERE private_plugin.id = ${sqlAlias}.plugin_id AND private_plugin.owner_user_id IS NOT NULL AND ${sqlAlias}.incompatibility_reason = 'package-identity-conflict')`,
				),
		},
	},
};

const definitionFields = {
	id: physicalField("id", "text", false),
	slug: physicalField("slug", "text", false),
	name: physicalField("name", "text", false),
	pluginId: physicalField("plugin_id", "text"),
	packageId: physicalField("package_id", "text"),
	pluginRevisionId: physicalField("plugin_revision_id", "text"),
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
	visibility: {
		...effectiveDefinitionVisibility,
		plugin: { kind: "entity", type: "schemaDefinition" },
	},
	fields: {
		...definitionFields,
		editor: physicalField("editor", "json"),
		icon: physicalField("icon", "text", false),
		userState: physicalField("user_state", "json"),
		mergeIdentityProperties: textArrayField("merge_identity_properties"),
	},
};

const eventSchema: CatalogTable = {
	primaryKey: ["id"],
	name: "user_event_schema",
	materializedInIncludes: true,
	visibility: {
		...effectiveDefinitionVisibility,
		plugin: { kind: "event", type: "schemaDefinition" },
	},
	fields: {
		...definitionFields,
		entitySchemaSlug: physicalField("entity_schema_slug", "text", false),
	},
};

const relationshipSchema: CatalogTable = {
	primaryKey: ["id"],
	name: "user_relationship_schema",
	visibility: {
		...effectiveDefinitionVisibility,
		plugin: { kind: "relationship", type: "schemaDefinition" },
	},
	fields: {
		...definitionFields,
		userWritePolicy: physicalField("user_write_policy", "text"),
		sourceEntitySchemaSlug: physicalField("source_entity_schema_slug", "text"),
		targetEntitySchemaSlug: physicalField("target_entity_schema_slug", "text"),
	},
};

const signalSchema: CatalogTable = {
	primaryKey: ["id"],
	name: "user_signal_schema",
	visibility: {
		...effectiveDefinitionVisibility,
		plugin: { kind: "signal", type: "schemaDefinition" },
	},
	fields: {
		...definitionFields,
		catalogState: physicalField("catalog_state", "text", false),
		audiencePolicy: physicalField("audience_policy", "json", false),
	},
};

const calendarSource: CatalogTable = {
	primaryKey: ["pluginId", "slug"],
	name: "user_calendar_source_effective",
	visibility: effectiveDefinitionVisibility,
	fields: {
		art: physicalField("art", "text"),
		done: physicalField("done", "text"),
		caption: physicalField("caption", "text"),
		icon: physicalField("icon", "text", false),
		name: physicalField("name", "text", false),
		slug: physicalField("slug", "text", false),
		query: physicalField("query", "json", false),
		subject: physicalField("subject", "json", false),
		startAt: physicalField("start_at", "text", false),
		pluginId: physicalField("plugin_id", "text", false),
		precision: physicalField("precision", "text", false),
		isHidden: physicalField("is_hidden", "boolean", false),
	},
};

const executableDefinitionVisibility: CatalogVisibility = {
	user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: false },
};

const executableDefinitionFields = {
	id: physicalField("id", "text", false),
	slug: physicalField("slug", "text", false),
	name: physicalField("name", "text", false),
	pluginId: physicalField("plugin_id", "text"),
	packageId: physicalField("package_id", "text"),
	pluginScope: physicalField("plugin_scope", "text"),
	installationId: physicalField("installation_id", "text"),
	description: physicalField("description", "text", false),
};

const pluginConfigEnvironmentSegment = (value: string) =>
	`upper(regexp_replace(regexp_replace(regexp_replace(${value}, '([a-z0-9])([A-Z])', '\\1_\\2', 'g'), '[^a-zA-Z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'))`;

const pluginPackageEnvironmentSegment = (value: string, part: 1 | 2) =>
	`upper(replace(split_part(${value}, '/', ${part}), '-', '_'))`;

export const pluginConfigEnvironmentKeySql = (packageId: string, key: string) =>
	`'RYOT_PLUGIN__' || ${pluginPackageEnvironmentSegment(packageId, 1)} || '__' || ${pluginPackageEnvironmentSegment(packageId, 2)} || '__' || ${pluginConfigEnvironmentSegment(key)}`;

const missingPluginConfigKeys = (sqlAlias: string) => `COALESCE((
		SELECT jsonb_agg(CASE WHEN ${sqlAlias}.plugin_scope = 'system' THEN ${pluginConfigEnvironmentKeySql(`${sqlAlias}.package_id`, "required_key.key")} ELSE required_key.key END ORDER BY required_key.position)
		FROM unnest(${sqlAlias}.required_plugin_config_keys) WITH ORDINALITY required_key(key, position)
		WHERE NOT COALESCE(${ingestionReadinessMetadataSql(sqlAlias)}->'availableConfigKeys', '[]'::jsonb) ? required_key.key
	), '[]'::jsonb)`;

const importSource: CatalogTable = {
	primaryKey: ["id"],
	name: "user_import_source",
	visibility: executableDefinitionVisibility,
	fields: {
		...executableDefinitionFields,
		plan: physicalField("plan", "json"),
		exportHelp: physicalField("export_help", "json"),
		inputSchema: physicalField("input_schema", "json", false),
		workflowSlug: physicalField("workflow_slug", "text", false),
		requiredPluginConfigKeys: textArrayField("required_plugin_config_keys"),
		readinessMetadata: {
			kind: "json",
			nullable: true,
			resolve: ({ sqlAlias }) => sql.raw(ingestionReadinessMetadataSql(sqlAlias)),
		},
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
					`(${sqlAlias}.plugin_id IS NULL OR (${sqlAlias}.workflow_script_id IS NOT NULL AND jsonb_array_length(${missingPluginConfigKeys(sqlAlias)}) = 0))`,
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
		plan: physicalField("plan", "json"),
		lot: physicalField("lot", "text", false),
		scriptSlug: physicalField("script_slug", "text"),
		settingsSchema: physicalField("settings_schema", "json", false),
		requiresProKey: physicalField("requires_pro_key", "boolean", false),
		supportsOwnershipSync: physicalField("supports_ownership_sync", "boolean", false),
		readinessMetadata: {
			kind: "json",
			nullable: true,
			resolve: ({ sqlAlias }) => sql.raw(ingestionReadinessMetadataSql(sqlAlias)),
		},
		hasScript: {
			kind: "boolean",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(${sqlAlias}.plugin_id IS NULL OR ${sqlAlias}.lot = 'push' OR ${sqlAlias}.script_id IS NOT NULL)`,
				),
		},
		readinessConnections: {
			kind: "json",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`COALESCE((SELECT jsonb_agg(jsonb_build_object('id', connection.id, 'field', connection.field, 'integrationId', connection.integration_id, 'provider', connection.oauth_provider_slug)) FROM oauth_connection connection WHERE connection.user_id = ${sqlAlias}.user_id AND connection.plugin_installation_id = ${sqlAlias}.installation_id AND connection.integration_provider_slug = ${sqlAlias}.slug AND connection.status = 'connected' AND (connection.expires_at IS NULL OR connection.expires_at > now())), '[]'::jsonb)`,
				),
		},
	},
};

const sandboxProvider: CatalogTable = {
	primaryKey: ["id"],
	materializedInIncludes: true,
	name: "user_sandbox_provider",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		id: physicalField("id", "text", false),
		slug: physicalField("slug", "text", false),
		name: physicalField("name", "text", false),
		pluginId: physicalField("plugin_id", "text", false),
		packageId: physicalField("package_id", "text", false),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		information: physicalField("information", "json", false),
		rootEntitySchemaSlug: physicalField("root_entity_schema_slug", "text", false),
	},
};

const sandboxProviderOperation: CatalogTable = {
	primaryKey: ["providerId", "operation"],
	name: "user_sandbox_provider_operation",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		pluginId: physicalField("plugin_id", "text", false),
		operation: physicalField("operation", "text", false),
		packageId: physicalField("package_id", "text", false),
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
		slug: physicalField("slug", "text", false),
		name: physicalField("name", "text", false),
		icon: physicalField("icon", "text", false),
		pluginId: physicalField("plugin_id", "text"),
		packageId: physicalField("package_id", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		renderer: physicalField("renderer", "json", false),
		settings: physicalField("settings", "json", false),
		dataSources: physicalField("data_sources", "json"),
		revision: physicalField("revision", "number", false),
		isHidden: physicalField("is_hidden", "boolean", false),
		sortOrder: physicalField("sort_order", "number", false),
		isBuiltin: physicalField("is_builtin", "boolean", false),
		pluginInstallationId: physicalField("plugin_installation_id", "text"),
		reference: {
			kind: "json",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`CASE WHEN NOT ${sqlAlias}.is_builtin THEN jsonb_build_object('kind', 'custom', 'savedViewId', ${sqlAlias}.id) WHEN ${sqlAlias}.plugin_id IS NULL THEN jsonb_build_object('kind', 'kernel', 'slug', ${sqlAlias}.slug) ELSE jsonb_build_object('kind', 'plugin', 'pluginId', ${sqlAlias}.plugin_id, 'slug', ${sqlAlias}.slug) END`,
				),
		},
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
		signalSchemaPluginId: physicalField("signal_schema_plugin_id", "text"),
	},
};

const integration: CatalogTable = {
	primaryKey: ["id"],
	name: "integration",
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	},
	fields: {
		packageId: installationPackageId,
		name: physicalField("name", "text"),
		id: physicalField("id", "text", false),
		lot: physicalField("lot", "text", false),
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
		pluginId: {
			kind: "text",
			nullable: true,
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(SELECT installation.plugin_id FROM plugin_installation installation WHERE installation.id = ${sqlAlias}.plugin_installation_id AND installation.user_id = ${sqlAlias}.user_id)`,
				),
		},
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
		expiryReason: physicalField("expiry_reason", "text"),
		createdAt: physicalField("created_at", "date", false),
		updatedAt: physicalField("updated_at", "date", false),
		blockDeadline: physicalField("block_deadline", "date"),
		failureReason: physicalField("failure_reason", "json"),
		integrationId: physicalField("integration_id", "text"),
		blockReasons: physicalField("block_reasons", "json", false),
		inputSummary: physicalField("input_summary", "json", false),
		pluginInstallationId: physicalField("plugin_installation_id", "text"),
		summary: {
			kind: "json",
			nullable: false,
			resolve: ({ sqlAlias }) => ingestionSummarySql(sqlAlias),
		},
		activities: {
			kind: "json",
			nullable: false,
			resolve: ({ sqlAlias }) => ingestionActivitiesSql(sqlAlias),
		},
	},
};

const importIssue: CatalogTable = {
	name: "import_issue",
	primaryKey: ["runId", "id"],
	fields: {
		id: physicalField("id", "text", false),
		data: physicalField("data", "json", false),
		runId: physicalField("run_id", "text", false),
	},
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
		twoFactorStatus: {
			kind: "json",
			nullable: false,
			access: "kernel",
			demoReadable: false,
			resolve: ({ sqlAlias }) =>
				sql.raw(`jsonb_build_object(
				'enabled', COALESCE(${sqlAlias}.two_factor_enabled, false),
				'available', ${accountProviderExists(sqlAlias, "credential")}
			)`),
		},
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

const oauthConnection: CatalogTable = {
	primaryKey: ["id"],
	name: "oauth_connection",
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
		status: {
			kind: "text",
			nullable: false,
			resolve: ({ sqlAlias }) =>
				sql.raw(`CASE
				WHEN ${sqlAlias}.status <> 'failed'
					AND ${sqlAlias}.expires_at <= statement_timestamp() THEN 'expired'
				ELSE ${sqlAlias}.status
			END`),
		},
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
		lane: withAccess(physicalField("lane", "text", false), "admin"),
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
					`(SELECT revision.name FROM plugin_revision revision WHERE revision.id = ${sqlAlias}.plugin_revision_id)`,
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
	name: "entity_translation",
	primaryKey: ["entityId", "language"],
	visibility: { admin: { type: "all" } },
	fields: {
		name: physicalField("name", "text"),
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
	eventScope,
	eventStream,
	eventSchema,
	integration,
	importIssue,
	entitySchema,
	importSource,
	relationship,
	signalSchema,
	sandboxScript,
	automationRun,
	backgroundWork,
	calendarSource,
	oauthConnection,
	eventProjection,
	eventStreamWork,
	migrationReport,
	sandboxProvider,
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

export const jsonElementsTable: CatalogTable = {
	visibility: {},
	name: "jsonElements",
	primaryKey: ["ordinal"],
	fields: {
		ordinal: physicalField("ordinal", "number", false),
		value: {
			kind: "json",
			nullable: true,
			resolve: ({ sqlAlias }) =>
				sql`NULLIF(${sql.raw(sqlAlias)}.${sql.identifier("value")}, 'null'::jsonb)`,
		},
	},
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
	resolveTable: (alias: string) => undefined | CatalogTable,
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
