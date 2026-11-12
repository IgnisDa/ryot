import { KernelSavedViewRendererName } from "@ryot-app/contract/modules/saved-views/schemas";
import type { AccessClass } from "@ryot-app/contract/oauth";
import {
	type CatalogField,
	type CatalogTable,
	type CatalogTableName,
	type catalogTables,
	getCatalogTable,
	jsonElementsTable,
	type RyotQLAudience,
	SOURCE_ENTITY_TABLE_PREFIX,
	sourceEntityTable,
} from "@ryot-app/ryotql/catalog";
import { sql } from "drizzle-orm";

import type { DefinitionReadContext } from "#modules/definitions/read-context";
import { ingestionReadinessMetadataSql } from "#modules/plugins/catalog/readiness-projection";
import type {
	PluginSchemaScope,
	ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";

import { ingestionActivitiesSql, ingestionSummarySql } from "./ingestion-projection";

export type CatalogSource = (context: {
	readonly source: SqlFragment;
	readonly userId: null | string;
	readonly fields: ReadonlySet<string>;
	readonly relation: (name: string) => SqlFragment;
}) => { readonly from: SqlFragment; readonly ctes: Readonly<Record<string, SqlFragment>> };

export type RyotQLExecutionScope = (
	UserExecutionScope | PluginExecutionScope | PublicationExecutionScope | { readonly type: "admin" }
) & {
	readonly cursorIdentity?: string;
	readonly sourceRevisions?: Readonly<Record<string, number>>;
	readonly sourceEntities?: Readonly<
		Record<string, readonly { readonly rank: number; readonly entityId: string }[]>
	>;
};

type SqlFragment = ReturnType<typeof sql>;

type PhysicalCatalogField = CatalogField & FieldBinding;

type FieldBinding = {
	readonly column?: string;
	readonly resolve: (context: CatalogFieldContext) => SqlFragment;
};

type CatalogFieldContext = {
	readonly sqlAlias: string;
	readonly userId?: null | string;
	readonly language: null | string;
};

const noCtes: Readonly<Record<string, SqlFragment>> = {};

export type PhysicalCatalogTable = CatalogTable<PhysicalCatalogField> & {
	readonly relation: string;
	readonly source?: CatalogSource;
	readonly policies: CatalogPolicies;
};

type LogicalTable<Name extends CatalogTableName> = (typeof catalogTables)[Name];

type CatalogPolicies = {
	readonly [Audience in keyof PolicyByAudience]?: PolicyByAudience[Audience];
};

/** Reads only a publication's subjects, which the statement receives as `publication_subject`. */
type PublicationExecutionScope = {
	readonly type: "publication";
	readonly ownerUserId: string;
	readonly subjectsJson: string;
	readonly language: null | string;
};

type PolicyByAudience = {
	readonly user: CatalogUserPolicy;
	readonly plugin: CatalogPluginPolicy;
	readonly admin: { readonly type: "all" };
	readonly publication: CatalogPublicationPolicy;
};

type CatalogPublicationPolicy =
	| { readonly type: "none" }
	| { readonly type: "subject" }
	| { readonly type: "subjectLink" }
	| { readonly type: "systemPlugin" }
	| { readonly type: "systemDefinition" };

type PluginExecutionScope = PluginSchemaScope & {
	readonly type: "plugin";
	readonly pluginId: ScriptPluginRevision["id"];
	readonly packageId: ScriptPluginRevision["packageId"];
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

type TableBinding<Name extends CatalogTableName> = {
	readonly relation: string;
	readonly source?: CatalogSource;
	readonly fields: { readonly [Field in keyof LogicalTable<Name>["fields"]]: FieldBinding };
	readonly policies: {
		readonly [
			Audience in keyof PolicyByAudience & keyof LogicalTable<Name>["visibility"]
		]: PolicyByAudience[Audience];
	};
};

type CatalogPluginPolicy =
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

const bindTable = (
	logical: CatalogTable,
	binding: {
		readonly relation: string;
		readonly source?: CatalogSource;
		readonly policies: CatalogPolicies;
		readonly fields: Readonly<Record<string, FieldBinding>>;
	},
): PhysicalCatalogTable => ({
	...logical,
	policies: binding.policies,
	relation: binding.relation,
	...(binding.source ? { source: binding.source } : {}),
	fields: Object.fromEntries(
		Object.entries(logical.fields).map(([name, field]) => {
			const fieldBinding = binding.fields[name];
			if (!fieldBinding) {
				throw new Error(`Catalog field '${name}' has no physical binding`);
			}
			return [name, { ...field, ...fieldBinding }];
		}),
	),
});

const column = (name: string): FieldBinding => ({
	column: name,
	resolve: ({ sqlAlias }) => sql`${sql.raw(sqlAlias)}.${sql.identifier(name)}`,
});

const textArrayField = (name: string): FieldBinding => ({
	resolve: ({ sqlAlias }) => sql`to_jsonb(${sql.raw(sqlAlias)}.${sql.identifier(name)})`,
});

const installationPackageId: FieldBinding = {
	resolve: ({ sqlAlias }) =>
		sql.raw(
			`(SELECT plugin.package_id FROM plugin_installation installation INNER JOIN plugin ON plugin.id = installation.plugin_id WHERE installation.id = ${sqlAlias}.plugin_installation_id)`,
		),
};

const pluginActiveRevisionField = (expression: string): FieldBinding => ({
	resolve: ({ sqlAlias }) =>
		sql.raw(
			`(SELECT ${expression} FROM plugin_revision revision WHERE revision.id = ${sqlAlias}.active_revision_id)`,
		),
});

const pluginMetadataField = (key: "icon" | "name" | "description"): FieldBinding =>
	pluginActiveRevisionField(`revision.${key}`);

const pluginClientApiVersion = pluginActiveRevisionField(`(revision.client ->> 'apiVersion')::int`);

const localizedEntityName: FieldBinding = {
	resolve: ({ language, sqlAlias }) =>
		language === null
			? sql.raw(`${sqlAlias}.name`)
			: sql`COALESCE((SELECT translation.name FROM entity_translation translation WHERE translation.entity_id = ${sql.raw(`${sqlAlias}.id`)} AND translation.language = ${language} AND translation.source_content_generation = ${sql.raw(`${sqlAlias}.content_generation`)}), ${sql.raw(`${sqlAlias}.name`)})`,
};

const localizedEntityProperties: FieldBinding = {
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
		order by request.sequence desc limit 1), 'idle')`;
};

const entityTranslationStatus: FieldBinding = {
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

const entityPopulationStatus: FieldBinding = {
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

const entityRelatedPopulationStatus: FieldBinding = {
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

const entity: TableBinding<"entity"> = {
	relation: "entity",
	policies: {
		publication: { type: "subject" },
		user: { type: "owned", column: "user_id", includeGlobal: true },
		plugin: {
			globalOnly: true,
			type: "discriminator",
			column: "entity_schema_slug",
			ownership: "entitySchemaSlugs",
			ownerColumn: "entity_schema_plugin_id",
		},
	},
	fields: {
		id: column("id"),
		name: localizedEntityName,
		userId: column("user_id"),
		occursAt: column("occurs_at"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		externalId: column("external_id"),
		providerId: column("provider_id"),
		populatedAt: column("populated_at"),
		properties: localizedEntityProperties,
		populationStatus: entityPopulationStatus,
		translationStatus: entityTranslationStatus,
		entitySchemaSlug: column("entity_schema_slug"),
		relatedPopulationStatus: entityRelatedPopulationStatus,
		entitySchemaPluginId: column("entity_schema_plugin_id"),
		collectionOrderRevision: column("collection_order_revision"),
		publicationRank: {
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(SELECT publication_subject.rank FROM publication_subject WHERE publication_subject.entity_id = ${sqlAlias}.id)`,
				),
		},
		providerCheckedAt: {
			resolve: ({ sqlAlias }) =>
				sql`(select max(request.base_checked_at) from entity_enrichment_request request where request.entity_id = ${sql.raw(`${sqlAlias}.id`)})`,
		},
	},
};

const projectionDeclarations = (userId: null | string) => sql`
	select distinct d.user_id, d.plugin_id, d.entity_schema_slug, d.slug
	from user_event_schema d where d.is_effective and d.projection is not null
	and ${userId === null ? sql`true` : sql`d.user_id = ${userId}`}`;

/** A fold output's status: failed with its subject's last fold job, pending while one is queued or before the output exists. */
const derivedStatus = (value: string, subject: string) =>
	sql.raw(`case
	when ${subject}.status = 'failed' then 'failed'
	when ${value}.target_id is null or ${subject}.status is distinct from 'ready' then 'pending'
	else 'ready' end`);

const eventSource: CatalogSource = (context) => {
	const value = context.fields.has("projection");
	const status = context.fields.has("projectionStatus");
	if (!value && !status) {
		return { ctes: noCtes, from: context.source };
	}
	const declarations = context.relation("projectionDeclarations");
	return {
		ctes: status ? { projectionDeclarations: projectionDeclarations(context.userId) } : noCtes,
		from: sql`(select e.*
			${value ? sql`, p.value as projection_value` : sql``}
			${status ? sql`, case when d.slug is null then 'none' else ${derivedStatus("p", "f")} end as projection_status` : sql``}
			from ${context.source} e
			left join derived_value p on p.user_id = e.user_id and p.kind = 'event' and p.target_id = e.id
			${
				status
					? sql`left join lateral (select f.status from derived_value f
					where f.user_id = e.user_id and f.kind = 'subject' and f.target_id in
						(coalesce(p.subject_entity_id, e.entity_id), coalesce(p.subject_entity_id, e.session_entity_id))
					order by f.status = 'failed' desc limit 1) f on true
				left join entity subject on subject.id = e.entity_id
				left join ${declarations} d on d.user_id = e.user_id and d.entity_schema_slug = subject.entity_schema_slug
					and d.plugin_id is not distinct from e.event_schema_plugin_id and d.slug = e.event_schema_slug`
					: sql``
			}
		)`,
	};
};

const event: TableBinding<"event"> = {
	relation: "event",
	source: eventSource,
	policies: {
		publication: { type: "none" },
		plugin: { type: "eventDefinition" },
		user: { type: "owned", column: "user_id", includeGlobal: false },
	},
	fields: {
		id: column("id"),
		userId: column("user_id"),
		revision: column("revision"),
		entityId: column("entity_id"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		properties: column("properties"),
		occurredAt: column("occurred_at"),
		projection: column("projection_value"),
		sessionEntityId: column("session_entity_id"),
		eventSchemaSlug: column("event_schema_slug"),
		eventSchemaPluginId: column("event_schema_plugin_id"),
		projectionStatus: {
			resolve: ({ sqlAlias }) => sql`coalesce(${sql.raw(sqlAlias)}.projection_status, 'none')`,
		},
		orderKey: {
			resolve: ({ sqlAlias }) =>
				sql`coalesce(${sql.raw(sqlAlias)}.order_key, ${sql.raw(sqlAlias)}.id)`,
		},
		orderCreatedAt: {
			resolve: ({ sqlAlias }) =>
				sql`coalesce(${sql.raw(sqlAlias)}.order_created_at, ${sql.raw(sqlAlias)}.created_at)`,
		},
	},
};

const eventScope: TableBinding<"eventScope"> = {
	relation: "event_scope",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		revision: column("revision"),
		entityId: column("entity_id"),
		eventSchemaPluginId: column("event_schema_plugin_id"),
	},
};

const relationship: TableBinding<"relationship"> = {
	relation: "relationship",
	policies: {
		admin: { type: "all" },
		publication: { type: "subjectLink" },
		user: { type: "owned", column: "user_id", includeGlobal: true },
		plugin: {
			globalOnly: false,
			type: "discriminator",
			column: "relationship_schema_slug",
			ownership: "relationshipSchemaSlugs",
			ownerColumn: "relationship_schema_plugin_id",
		},
	},
	fields: {
		id: column("id"),
		userId: column("user_id"),
		createdAt: column("created_at"),
		properties: column("properties"),
		sourceEntityId: column("source_entity_id"),
		targetEntityId: column("target_entity_id"),
		relationshipSchemaSlug: column("relationship_schema_slug"),
		relationshipSchemaPluginId: column("relationship_schema_plugin_id"),
		projection: {
			resolve: ({ sqlAlias }) =>
				sql`(select p.value from derived_value p where p.user_id = ${sql.raw(sqlAlias)}.user_id
				and p.kind = 'relationship' and p.target_id = ${sql.raw(sqlAlias)}.id)`,
		},
		collectionRank: {
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(case when ${sqlAlias}.relationship_schema_slug = 'member-of' and ${sqlAlias}.relationship_schema_plugin_id is null then (${sqlAlias}.properties ->> 'rank')::double precision end)`,
				),
		},
		projectionStatus: {
			resolve: ({ sqlAlias }) => sql`case when exists (select 1 from user_relationship_schema d
					where d.user_id = ${sql.raw(sqlAlias)}.user_id
					and d.plugin_id is not distinct from ${sql.raw(sqlAlias)}.relationship_schema_plugin_id
					and d.slug = ${sql.raw(sqlAlias)}.relationship_schema_slug and d.is_effective and d.projection is not null)
				then (select ${derivedStatus("p", "f")} from (select 1) one
					left join derived_value p on p.user_id = ${sql.raw(sqlAlias)}.user_id
						and p.kind = 'relationship' and p.target_id = ${sql.raw(sqlAlias)}.id
					left join derived_value f on f.user_id = ${sql.raw(sqlAlias)}.user_id and f.kind = 'subject'
						and f.target_id = ${sql.raw(sqlAlias)}.source_entity_id)
				else 'none' end`,
		},
	},
};

const plugin: TableBinding<"plugin"> = {
	relation: "plugin",
	policies: {
		admin: { type: "all" },
		publication: { type: "systemPlugin" },
		user: { type: "owned", includeGlobal: true, column: "owner_user_id" },
	},
	fields: {
		id: column("id"),
		status: column("status"),
		packageId: column("package_id"),
		icon: pluginMetadataField("icon"),
		name: pluginMetadataField("name"),
		activationId: column("activation_id"),
		clientApiVersion: pluginClientApiVersion,
		activeRevisionId: column("active_revision_id"),
		description: pluginMetadataField("description"),
		version: pluginActiveRevisionField("revision.version"),
		ingestedAt: pluginActiveRevisionField("revision.created_at"),
		contentHash: pluginActiveRevisionField("revision.content_hash"),
		environmentConfigRevisionId: column("environment_config_revision_id"),
		configSchema: pluginActiveRevisionField("revision.client_config_schema"),
		clientEntities: pluginActiveRevisionField("revision.client -> 'entities'"),
		userSettingsSchema: pluginActiveRevisionField("revision.user_settings_schema"),
		clientCollectionPages: pluginActiveRevisionField("revision.client -> 'collectionPages'"),
		scope: {
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

const effectiveHomeSavedView: FieldBinding = {
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

const pluginInstallation: TableBinding<"pluginInstallation"> = {
	relation: "plugin_installation",
	policies: {
		admin: { type: "all" },
		user: {
			type: "owned",
			column: "user_id",
			includeGlobal: false,
			where: "uninstalled_at IS NULL",
		},
	},
	fields: {
		id: column("id"),
		health: column("health"),
		pluginId: column("plugin_id"),
		isHidden: column("is_hidden"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		sortOrder: column("sort_order"),
		config: column("client_config"),
		homeSavedView: effectiveHomeSavedView,
		healthReason: column("health_reason"),
		userSettings: column("user_settings"),
		isInitialized: column("is_initialized"),
		incompatibilityReason: column("incompatibility_reason"),
		activeConfigRevisionId: column("active_config_revision_id"),
		configuredSecrets: textArrayField("configured_secret_paths"),
		conflictingSystemPluginId: {
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(SELECT system_plugin.id FROM plugin private_plugin JOIN plugin system_plugin ON system_plugin.package_id = private_plugin.package_id AND system_plugin.owner_user_id IS NULL AND system_plugin.status = 'active' WHERE private_plugin.id = ${sqlAlias}.plugin_id AND private_plugin.owner_user_id IS NOT NULL AND ${sqlAlias}.incompatibility_reason = 'package-identity-conflict')`,
				),
		},
	},
};

const definitionFields = {
	id: column("id"),
	slug: column("slug"),
	name: column("name"),
	pluginId: column("plugin_id"),
	packageId: column("package_id"),
	propertiesSchema: column("properties_schema"),
	pluginRevisionId: column("plugin_revision_id"),
};

const effectiveDefinitionPolicies: { readonly user: CatalogUserPolicy } = {
	user: { type: "owned", column: "user_id", includeGlobal: false, where: "is_effective" },
};

const entitySchema: TableBinding<"entitySchema"> = {
	relation: "user_entity_schema",
	policies: {
		...effectiveDefinitionPolicies,
		publication: { type: "systemDefinition" },
		plugin: { kind: "entity", type: "schemaDefinition" },
	},
	fields: {
		...definitionFields,
		icon: column("icon"),
		editor: column("editor"),
		browse: column("browse"),
		userState: column("user_state"),
		mergeIdentityProperties: textArrayField("merge_identity_properties"),
	},
};

const eventSchema: TableBinding<"eventSchema"> = {
	relation: "user_event_schema",
	fields: { ...definitionFields, entitySchemaSlug: column("entity_schema_slug") },
	policies: {
		...effectiveDefinitionPolicies,
		publication: { type: "systemDefinition" },
		plugin: { kind: "event", type: "schemaDefinition" },
	},
};

const relationshipSchema: TableBinding<"relationshipSchema"> = {
	relation: "user_relationship_schema",
	policies: {
		...effectiveDefinitionPolicies,
		publication: { type: "systemDefinition" },
		plugin: { kind: "relationship", type: "schemaDefinition" },
	},
	fields: {
		...definitionFields,
		userWritePolicy: column("user_write_policy"),
		sourceEntitySchemaSlug: column("source_entity_schema_slug"),
		targetEntitySchemaSlug: column("target_entity_schema_slug"),
	},
};

const signalSchema: TableBinding<"signalSchema"> = {
	relation: "user_signal_schema",
	policies: {
		...effectiveDefinitionPolicies,
		plugin: { kind: "signal", type: "schemaDefinition" },
	},
	fields: {
		...definitionFields,
		catalogState: column("catalog_state"),
		audiencePolicy: column("audience_policy"),
	},
};

const calendarSource: TableBinding<"calendarSource"> = {
	policies: effectiveDefinitionPolicies,
	relation: "user_calendar_source_effective",
	fields: {
		art: column("art"),
		done: column("done"),
		icon: column("icon"),
		name: column("name"),
		slug: column("slug"),
		query: column("query"),
		caption: column("caption"),
		subject: column("subject"),
		startAt: column("start_at"),
		pluginId: column("plugin_id"),
		isHidden: column("is_hidden"),
		precision: column("precision"),
	},
};

const executableDefinitionPolicies: { readonly user: CatalogUserPolicy } = {
	user: { type: "owned", column: "user_id", includeGlobal: false },
};

const executableDefinitionFields = {
	id: column("id"),
	slug: column("slug"),
	name: column("name"),
	pluginId: column("plugin_id"),
	packageId: column("package_id"),
	description: column("description"),
	pluginScope: column("plugin_scope"),
	installationId: column("installation_id"),
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

const importSource: TableBinding<"importSource"> = {
	relation: "user_import_source",
	policies: executableDefinitionPolicies,
	fields: {
		...executableDefinitionFields,
		plan: column("plan"),
		exportHelp: column("export_help"),
		inputSchema: column("input_schema"),
		workflowSlug: column("workflow_slug"),
		requiredPluginConfigKeys: textArrayField("required_plugin_config_keys"),
		readinessMetadata: {
			resolve: ({ sqlAlias }) => sql.raw(ingestionReadinessMetadataSql(sqlAlias)),
		},
		missingPluginConfigKeys: {
			resolve: ({ sqlAlias }) => sql.raw(missingPluginConfigKeys(sqlAlias)),
		},
		isStartable: {
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(${sqlAlias}.plugin_id IS NULL OR (${sqlAlias}.workflow_script_id IS NOT NULL AND jsonb_array_length(${missingPluginConfigKeys(sqlAlias)}) = 0))`,
				),
		},
	},
};

const integrationProvider: TableBinding<"integrationProvider"> = {
	relation: "user_integration_provider",
	policies: executableDefinitionPolicies,
	fields: {
		...executableDefinitionFields,
		lot: column("lot"),
		plan: column("plan"),
		scriptSlug: column("script_slug"),
		settingsSchema: column("settings_schema"),
		requiresProKey: column("requires_pro_key"),
		supportsOwnershipSync: column("supports_ownership_sync"),
		readinessMetadata: {
			resolve: ({ sqlAlias }) => sql.raw(ingestionReadinessMetadataSql(sqlAlias)),
		},
		hasScript: {
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(${sqlAlias}.plugin_id IS NULL OR ${sqlAlias}.lot = 'push' OR ${sqlAlias}.script_id IS NOT NULL)`,
				),
		},
		readinessConnections: {
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`COALESCE((SELECT jsonb_agg(jsonb_build_object('id', connection.id, 'field', connection.field, 'integrationId', connection.integration_id, 'provider', connection.oauth_provider_slug)) FROM oauth_connection connection WHERE connection.user_id = ${sqlAlias}.user_id AND connection.plugin_installation_id = ${sqlAlias}.installation_id AND connection.integration_provider_slug = ${sqlAlias}.slug AND connection.status = 'connected' AND (connection.expires_at IS NULL OR connection.expires_at > now())), '[]'::jsonb)`,
				),
		},
	},
};

const sandboxProvider: TableBinding<"sandboxProvider"> = {
	relation: "user_sandbox_provider",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		slug: column("slug"),
		name: column("name"),
		pluginId: column("plugin_id"),
		packageId: column("package_id"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		information: column("information"),
		rootEntitySchemaSlug: column("root_entity_schema_slug"),
	},
};

const sandboxProviderOperation: TableBinding<"sandboxProviderOperation"> = {
	relation: "user_sandbox_provider_operation",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		pluginId: column("plugin_id"),
		operation: column("operation"),
		packageId: column("package_id"),
		providerId: column("provider_id"),
		optionsSchema: column("options_schema"),
	},
};

const page: TableBinding<"page"> = {
	relation: "page",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		slug: column("slug"),
		name: column("name"),
		origin: column("origin"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		writeAccess: column("write_access"),
		draftRevision: column("draft_revision"),
		draftDefinition: column("draft_definition"),
		publishedRevision: column("published_revision"),
		authorityRevision: column("authority_revision"),
		draftArtifactHash: column("draft_artifact_hash"),
		publishedDefinition: column("published_definition"),
		draftDefinitionHash: column("draft_definition_hash"),
		publishedArtifactHash: column("published_artifact_hash"),
		draftCompiledRevision: column("draft_compiled_revision"),
		publishedDefinitionHash: column("published_definition_hash"),
	},
};

const savedView: TableBinding<"savedView"> = {
	relation: "user_saved_view_effective",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		sort: column("sort"),
		slug: column("slug"),
		name: column("name"),
		icon: column("icon"),
		filter: column("filter"),
		renderer: column("renderer"),
		settings: column("settings"),
		revision: column("revision"),
		pluginId: column("plugin_id"),
		isHidden: column("is_hidden"),
		arguments: column("arguments"),
		packageId: column("package_id"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		sortOrder: column("sort_order"),
		isBuiltin: column("is_builtin"),
		dataSources: column("data_sources"),
		pluginInstallationId: column("plugin_installation_id"),
		reference: {
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`CASE WHEN NOT ${sqlAlias}.is_builtin THEN jsonb_build_object('kind', 'custom', 'savedViewId', ${sqlAlias}.id) WHEN ${sqlAlias}.plugin_id IS NULL THEN jsonb_build_object('kind', 'kernel', 'slug', ${sqlAlias}.slug) ELSE jsonb_build_object('kind', 'plugin', 'pluginId', ${sqlAlias}.plugin_id, 'slug', ${sqlAlias}.slug) END`,
				),
		},
	},
};

const notificationChannel: TableBinding<"notificationChannel"> = {
	relation: "notification_channel",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		channel: column("platform"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		isDisabled: column("is_disabled"),
		description: column("description"),
	},
};

const notification: TableBinding<"notification"> = {
	relation: "notification",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		state: column("state"),
		reason: column("reason"),
		outcome: column("outcome"),
		settledAt: column("settled_at"),
		createdAt: column("created_at"),
		reminderId: {
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(select r.id from reminder r where r.formatter_run_id = ${sqlAlias}.source_run_id and r.user_id = ${sqlAlias}.user_id and r.removed_at is null)`,
				),
		},
	},
};

const notificationDelivery: TableBinding<"notificationDelivery"> = {
	relation: "notification_delivery",
	policies: {
		user: {
			parentColumn: "id",
			type: "parentOwned",
			column: "notification_id",
			parentTable: "notification",
			parentOwnerColumn: "user_id",
		},
	},
	fields: {
		id: column("id"),
		reason: column("reason"),
		status: column("status"),
		channel: column("channel"),
		claimedAt: column("claimed_at"),
		settledAt: column("settled_at"),
		channelId: column("channel_id"),
		description: column("description"),
		notificationId: column("notification_id"),
	},
};

const reminder: TableBinding<"reminder"> = {
	relation: "reminder",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		state: column("state"),
		dueAt: column("due_at"),
		reason: column("reason"),
		message: column("message"),
		outcome: column("outcome"),
		timezone: column("timezone"),
		revision: column("revision"),
		entityId: column("entity_id"),
		settledAt: column("settled_at"),
		removedAt: column("removed_at"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		entityTitle: column("entity_title"),
		processingAt: column("processing_at"),
		replacementId: column("replacement_id"),
		parentEntityId: column("parent_entity_id"),
		originalSchedule: column("original_schedule"),
	},
};

const notificationSubscription: TableBinding<"notificationSubscription"> = {
	relation: "notification_subscription",
	policies: {
		admin: { type: "all" },
		user: { type: "owned", column: "user_id", includeGlobal: false },
	},
	fields: {
		id: column("id"),
		userId: column("user_id"),
		isActive: column("is_active"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		signalSchemaSlug: column("signal_schema_slug"),
		signalSchemaPluginId: column("signal_schema_plugin_id"),
	},
};

const integration: TableBinding<"integration"> = {
	relation: "integration",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		lot: column("lot"),
		name: column("name"),
		provider: column("provider"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		packageId: installationPackageId,
		isDisabled: column("is_disabled"),
		webhookToken: column("webhook_token"),
		extraSettings: column("extra_settings"),
		syncOwnership: column("sync_ownership"),
		lastFinishedAt: column("last_finished_at"),
		minimumProgress: column("minimum_progress"),
		maximumProgress: column("maximum_progress"),
		providerSpecifics: column("client_provider_specifics"),
		pluginId: {
			resolve: ({ sqlAlias }) =>
				sql.raw(
					`(SELECT installation.plugin_id FROM plugin_installation installation WHERE installation.id = ${sqlAlias}.plugin_installation_id AND installation.user_id = ${sqlAlias}.user_id)`,
				),
		},
	},
};

const importRun: TableBinding<"importRun"> = {
	relation: "import_run",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		source: column("source"),
		status: column("status"),
		startedAt: column("started_at"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		finishedAt: column("finished_at"),
		expiryReason: column("expiry_reason"),
		blockReasons: column("block_reasons"),
		inputSummary: column("input_summary"),
		blockDeadline: column("block_deadline"),
		failureReason: column("failure_reason"),
		integrationId: column("integration_id"),
		pluginInstallationId: column("plugin_installation_id"),
		summary: { resolve: ({ sqlAlias }) => ingestionSummarySql(sqlAlias) },
		activities: { resolve: ({ sqlAlias }) => ingestionActivitiesSql(sqlAlias) },
	},
};

const importIssue: TableBinding<"importIssue"> = {
	relation: "import_issue",
	fields: { id: column("id"), data: column("data"), runId: column("run_id") },
	policies: {
		user: {
			column: "run_id",
			parentColumn: "id",
			type: "parentOwned",
			parentTable: "import_run",
			parentOwnerColumn: "user_id",
		},
	},
};

const accountProviderExists = (sqlAlias: string, providerId: string) =>
	`EXISTS (SELECT 1 FROM account WHERE account.user_id = ${sqlAlias}.id AND account.provider_id = '${providerId}')`;

const user: TableBinding<"user"> = {
	relation: "user",
	policies: { admin: { type: "all" }, user: { type: "self", column: "id" } },
	fields: {
		id: column("id"),
		name: column("name"),
		image: column("image"),
		email: column("email"),
		createdAt: column("created_at"),
		disabledAt: column("disabled_at"),
		preferences: column("preferences"),
		twoFactorEnabled: column("two_factor_enabled"),
		twoFactorStatus: {
			resolve: ({ sqlAlias }) =>
				sql.raw(`jsonb_build_object(
				'enabled', COALESCE(${sqlAlias}.two_factor_enabled, false),
				'available', ${accountProviderExists(sqlAlias, "credential")}
			)`),
		},
		authState: {
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
	},
};

const oauthConnection: TableBinding<"oauthConnection"> = {
	relation: "oauth_connection",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		status: {
			resolve: ({ sqlAlias }) =>
				sql.raw(`CASE
				WHEN ${sqlAlias}.status <> 'failed'
					AND ${sqlAlias}.expires_at <= statement_timestamp() THEN 'expired'
				ELSE ${sqlAlias}.status
			END`),
		},
	},
};

const backupRun: TableBinding<"backupRun"> = {
	relation: "backup_run",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		kind: column("kind"),
		status: column("status"),
		failure: column("failure"),
		progress: column("progress"),
		startedAt: column("started_at"),
		expiresAt: column("expires_at"),
		createdAt: column("created_at"),
		finishedAt: column("finished_at"),
		artifactProvider: column("artifact_provider"),
	},
};

const entityTranslation: TableBinding<"entityTranslation"> = {
	relation: "entity_translation",
	policies: { admin: { type: "all" } },
	fields: {
		name: column("name"),
		language: column("language"),
		entityId: column("entity_id"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		properties: column("properties"),
		populatedAt: column("populated_at"),
	},
};

const sandboxScript: TableBinding<"sandboxScript"> = {
	relation: "sandbox_script",
	policies: { admin: { type: "all" } },
	fields: {
		id: column("id"),
		slug: column("slug"),
		name: column("name"),
		metadata: column("metadata"),
		createdAt: column("created_at"),
		providerId: column("provider_id"),
		contentHash: column("content_hash"),
		compiledFormat: column("compiled_format"),
		pluginRevisionId: column("plugin_revision_id"),
	},
};

const userLifecycleOperation: TableBinding<"userLifecycleOperation"> = {
	relation: "user_lifecycle_operation",
	policies: { admin: { type: "all" } },
	fields: {
		id: column("id"),
		kind: column("kind"),
		status: column("status"),
		userId: column("user_id"),
		failure: column("failure"),
		startedAt: column("started_at"),
		createdAt: column("created_at"),
		finishedAt: column("finished_at"),
		resetResult: column("reset_result"),
	},
};

const migrationReportDetail: TableBinding<"migrationReportDetail"> = {
	relation: "migration_report_detail",
	policies: { admin: { type: "all" } },
	fields: {
		seq: column("seq"),
		detail: column("detail"),
		createdAt: column("created_at"),
		reportSeq: column("report_seq"),
	},
};

const migrationReportTotalDetails: FieldBinding = {
	resolve: ({ sqlAlias }) =>
		sql.raw(`CASE WHEN ${sqlAlias}.code IS NULL THEN NULL ELSE COALESCE(${sqlAlias}.count, 0) END`),
};

const migrationReport: TableBinding<"migrationReport"> = {
	relation: "migration_report",
	policies: { admin: { type: "all" } },
	fields: {
		seq: column("seq"),
		code: column("code"),
		count: column("count"),
		level: column("level"),
		phase: column("phase"),
		message: column("message"),
		createdAt: column("created_at"),
		totalDetails: migrationReportTotalDetails,
		elapsedSeconds: column("elapsed_seconds"),
	},
};

const publication: TableBinding<"publication"> = {
	relation: "publication",
	policies: { user: { type: "owned", column: "user_id", includeGlobal: false } },
	fields: {
		id: column("id"),
		icon: column("icon"),
		title: column("title"),
		source: column("source"),
		revision: column("revision"),
		revokedAt: column("revoked_at"),
		createdAt: column("created_at"),
		updatedAt: column("updated_at"),
		description: column("description"),
		showOwnerName: column("show_owner_name"),
	},
};

const publicationLink: TableBinding<"publicationLink"> = {
	relation: "publication_link",
	policies: {
		user: {
			parentColumn: "id",
			type: "parentOwned",
			column: "publication_id",
			parentTable: "publication",
			parentOwnerColumn: "user_id",
		},
	},
	fields: {
		id: column("id"),
		label: column("label"),
		expiresAt: column("expires_at"),
		revokedAt: column("revoked_at"),
		createdAt: column("created_at"),
		publicationId: column("publication_id"),
		lastExchangedAt: column("last_exchanged_at"),
	},
};

const bindings: { readonly [Name in CatalogTableName]: TableBinding<Name> } = {
	page,
	user,
	event,
	entity,
	plugin,
	reminder,
	backupRun,
	importRun,
	savedView,
	eventScope,
	publication,
	eventSchema,
	integration,
	importIssue,
	entitySchema,
	importSource,
	relationship,
	signalSchema,
	notification,
	sandboxScript,
	calendarSource,
	oauthConnection,
	migrationReport,
	sandboxProvider,
	publicationLink,
	entityTranslation,
	pluginInstallation,
	relationshipSchema,
	integrationProvider,
	notificationChannel,
	notificationDelivery,
	migrationReportDetail,
	userLifecycleOperation,
	sandboxProviderOperation,
	notificationSubscription,
};

const tables = new Map(
	Object.entries(bindings).map(([name, binding]) => {
		const logical = getCatalogTable(name);
		if (!logical) {
			throw new Error(`Catalog table '${name}' has no logical declaration`);
		}
		return [name, bindTable(logical, binding)] as const;
	}),
);

export const physicalJsonElementsTable = bindTable(jsonElementsTable, {
	policies: {},
	relation: "jsonElements",
	fields: {
		ordinal: column("ordinal"),
		value: {
			resolve: ({ sqlAlias }) =>
				sql`NULLIF(${sql.raw(sqlAlias)}.${sql.identifier("value")}, 'null'::jsonb)`,
		},
	},
});

export const physicalCatalogTable = (name: string): undefined | PhysicalCatalogTable => {
	const table = tables.get(name);
	if (table !== undefined || !name.startsWith(SOURCE_ENTITY_TABLE_PREFIX)) {
		return table;
	}
	return bindTable(sourceEntityTable, {
		relation: name,
		policies: { user: { type: "public" } },
		fields: { rank: column("rank"), entityId: column("entity_id") },
	});
};
