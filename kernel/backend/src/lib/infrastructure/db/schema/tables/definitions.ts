import type {
	PluginEntityUserStatePolicy,
	PluginImportSource,
	PluginIntegrationProvider,
	PluginSignalAudiencePolicy,
	PluginSignalSchema,
} from "@ryot-app/contract/modules/plugins/manifest";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { ProviderInformation } from "@ryot-app/contract/modules/sandbox/schemas";
import type { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	snakeCase,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

import { pluginRevision } from "./core";

type PluginScope = "system" | "user";
type InstallationHealth =
	| "installing"
	| "ready"
	| "needs-configuration"
	| "incompatible"
	| "failed";
type SavedViewSettings = Readonly<Record<string, JsonValue>>;

const definitionColumns = () => ({
	slug: text().notNull(),
	name: text().notNull(),
	position: integer().notNull(),
	id: text()
		.primaryKey()
		.$defaultFn(() => /* @__PURE__ */ generateId()),
});

export const definitionEntitySchema = snakeCase.table(
	"definition_entity_schema",
	{
		...definitionColumns(),
		pluginId: text(),
		icon: text().notNull(),
		pluginRevisionId: text(),
		mergeIdentityProperties: text().array().notNull(),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		userState: jsonb().$type<PluginEntityUserStatePolicy>(),
	},
	(table) => [
		check(
			"definition_entity_schema_owner_check",
			sql`(${table.pluginId} is null) = (${table.pluginRevisionId} is null)`,
		),
		foreignKey({
			name: "definition_entity_schema_revision_fk",
			columns: [table.pluginRevisionId, table.pluginId],
			foreignColumns: [pluginRevision.id, pluginRevision.pluginId],
		}).onDelete("cascade"),
		unique("definition_entity_schema_revision_slug_unique")
			.on(table.pluginRevisionId, table.slug)
			.nullsNotDistinct(),
		index("definition_entity_schema_slug_idx").on(table.slug),
	],
);

export const definitionEventSchema = snakeCase.table(
	"definition_event_schema",
	{
		...definitionColumns(),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		entitySchemaId: text()
			.notNull()
			.references(() => definitionEntitySchema.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("definition_event_schema_entity_slug_unique").on(table.entitySchemaId, table.slug),
	],
);

export const definitionRelationshipSchema = snakeCase.table(
	"definition_relationship_schema",
	{
		...definitionColumns(),
		pluginId: text(),
		pluginRevisionId: text(),
		sourceEntitySchemaSlug: text(),
		targetEntitySchemaSlug: text(),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
	},
	(table) => [
		check(
			"definition_relationship_schema_owner_check",
			sql`(${table.pluginId} is null) = (${table.pluginRevisionId} is null)`,
		),
		foreignKey({
			columns: [table.pluginRevisionId, table.pluginId],
			name: "definition_relationship_schema_revision_fk",
			foreignColumns: [pluginRevision.id, pluginRevision.pluginId],
		}).onDelete("cascade"),
		unique("definition_relationship_schema_revision_slug_unique")
			.on(table.pluginRevisionId, table.slug)
			.nullsNotDistinct(),
		index("definition_relationship_schema_slug_idx").on(table.slug),
	],
);

export const definitionSignalSchema = snakeCase.table(
	"definition_signal_schema",
	{
		...definitionColumns(),
		pluginId: text(),
		pluginRevisionId: text(),
		notificationHookSlug: text().notNull(),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		audiencePolicy: jsonb().$type<PluginSignalAudiencePolicy>().notNull(),
		catalogState: text().$type<PluginSignalSchema["catalogState"]>().notNull(),
	},
	(table) => [
		check(
			"definition_signal_schema_owner_check",
			sql`(${table.pluginId} is null) = (${table.pluginRevisionId} is null)`,
		),
		foreignKey({
			name: "definition_signal_schema_revision_fk",
			columns: [table.pluginRevisionId, table.pluginId],
			foreignColumns: [pluginRevision.id, pluginRevision.pluginId],
		}).onDelete("cascade"),
		unique("definition_signal_schema_revision_slug_unique")
			.on(table.pluginRevisionId, table.slug)
			.nullsNotDistinct(),
		index("definition_signal_schema_slug_idx").on(table.slug),
	],
);

export const definitionSavedView = snakeCase.table(
	"definition_saved_view",
	{
		...definitionColumns(),
		pluginId: text(),
		icon: text().notNull(),
		pluginRevisionId: text(),
		sortOrder: integer().notNull(),
		dataSources: jsonb().$type<RyotQLDocument>(),
		settings: jsonb().$type<SavedViewSettings>().notNull(),
		renderer: jsonb().$type<SavedViewRenderer>().notNull(),
	},
	(table) => [
		check(
			"definition_saved_view_owner_check",
			sql`(${table.pluginId} is null) = (${table.pluginRevisionId} is null)`,
		),
		foreignKey({
			name: "definition_saved_view_revision_fk",
			columns: [table.pluginRevisionId, table.pluginId],
			foreignColumns: [pluginRevision.id, pluginRevision.pluginId],
		}).onDelete("cascade"),
		unique("definition_saved_view_revision_slug_unique")
			.on(table.pluginRevisionId, table.slug)
			.nullsNotDistinct(),
		index("definition_saved_view_slug_idx").on(table.slug),
	],
);

export const definitionImportSource = snakeCase.table(
	"definition_import_source",
	{
		...definitionColumns(),
		pluginId: text().notNull(),
		workflowScriptSlug: text(),
		description: text().notNull(),
		workflowSlug: text().notNull(),
		pluginRevisionId: text().notNull(),
		inputSchema: jsonb().$type<AppSchema>().notNull(),
		requiredPluginConfigKeys: text().array().notNull(),
		exportHelp: jsonb().$type<NonNullable<PluginImportSource["exportHelp"]>>(),
	},
	(table) => [
		foreignKey({
			name: "definition_import_source_revision_fk",
			columns: [table.pluginRevisionId, table.pluginId],
			foreignColumns: [pluginRevision.id, pluginRevision.pluginId],
		}).onDelete("cascade"),
		unique("definition_import_source_revision_slug_unique").on(table.pluginRevisionId, table.slug),
		index("definition_import_source_slug_idx").on(table.slug),
	],
);

export const definitionIntegrationProvider = snakeCase.table(
	"definition_integration_provider",
	{
		...definitionColumns(),
		scriptSlug: text(),
		pluginId: text().notNull(),
		description: text().notNull(),
		pluginRevisionId: text().notNull(),
		requiresProKey: boolean().notNull(),
		settingsSchema: jsonb().$type<AppSchema>().notNull(),
		lot: text().$type<PluginIntegrationProvider["lot"]>().notNull(),
	},
	(table) => [
		check(
			"definition_integration_provider_script_check",
			sql`(${table.lot} = 'push') = (${table.scriptSlug} is null)`,
		),
		foreignKey({
			columns: [table.pluginRevisionId, table.pluginId],
			name: "definition_integration_provider_revision_fk",
			foreignColumns: [pluginRevision.id, pluginRevision.pluginId],
		}).onDelete("cascade"),
		unique("definition_integration_provider_revision_slug_unique").on(
			table.pluginRevisionId,
			table.slug,
		),
		index("definition_integration_provider_slug_idx").on(table.slug),
	],
);

const globalPluginQuery = sql`
	select p.id as plugin_id, p.slug, p.active_revision_id, p.environment_config_revision_id as config_revision_id, coalesce(c.scope = 'environment' and c.encrypted_payload is not null, false) as is_executable
	from plugin p
	left join plugin_config_revision c on c.id = p.environment_config_revision_id
	where p.scope = 'system' and p.status = 'active'
`;

export const globalPlugin = snakeCase
	.view("global_plugin", {
		slug: text().notNull(),
		configRevisionId: text(),
		pluginId: text().notNull(),
		isExecutable: boolean().notNull(),
		activeRevisionId: text().notNull(),
	})
	.as(globalPluginQuery);

const userPluginQuery = sql`
	select i.user_id, p.id as plugin_id, i.id as installation_id, p.slug, p.scope, p.owner_user_id, p.active_revision_id, case when p.scope = 'system' then p.environment_config_revision_id else i.active_config_revision_id end as config_revision_id, i.health, i.is_disabled, i.sort_order, i.health <> 'incompatible' as is_listed, not i.is_disabled and (i.health = 'ready' or (p.scope = 'system' and i.health = 'installing')) as is_definition_effective, coalesce(not i.is_disabled and i.health = 'ready' and c.plugin_revision_id = p.active_revision_id and c.encrypted_payload is not null and case when p.scope = 'system' then c.scope = 'environment' else c.scope = 'installation' and c.owner_user_id = i.user_id and c.plugin_installation_id = i.id end, false) as is_executable
	from plugin_installation i
	join plugin p on p.id = i.plugin_id
	left join plugin_config_revision c on c.id = case when p.scope = 'system' then p.environment_config_revision_id else i.active_config_revision_id end
	where i.uninstalled_at is null and p.status = 'active' and (p.scope = 'system' or p.owner_user_id = i.user_id)
`;

export const userPlugin = snakeCase
	.view("user_plugin", {
		ownerUserId: text(),
		slug: text().notNull(),
		userId: text().notNull(),
		configRevisionId: text(),
		pluginId: text().notNull(),
		isListed: boolean().notNull(),
		sortOrder: integer().notNull(),
		isDisabled: boolean().notNull(),
		installationId: text().notNull(),
		isExecutable: boolean().notNull(),
		activeRevisionId: text().notNull(),
		isDefinitionEffective: boolean().notNull(),
		scope: text().$type<PluginScope>().notNull(),
		health: text().$type<InstallationHealth>().notNull(),
	})
	.as(userPluginQuery);

const globalColumns = () => ({
	pluginId: text(),
	pluginSlug: text(),
	id: text().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	pluginRevisionId: text(),
	position: integer().notNull(),
});

const userColumns = () => ({
	...globalColumns(),
	userId: text().notNull(),
	isEffective: boolean().notNull(),
	pluginScope: text().$type<PluginScope>(),
});

const entitySchemaColumns = () => ({
	icon: text().notNull(),
	mergeIdentityProperties: text().array().notNull(),
	propertiesSchema: jsonb().$type<AppSchema>().notNull(),
	userState: jsonb().$type<PluginEntityUserStatePolicy>(),
});

const eventSchemaColumns = () => ({
	pluginId: text(),
	id: text().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	position: integer().notNull(),
	entitySchemaId: text().notNull(),
	entitySchemaSlug: text().notNull(),
	propertiesSchema: jsonb().$type<AppSchema>().notNull(),
});

const relationshipSchemaColumns = () => ({
	sourceEntitySchemaSlug: text(),
	targetEntitySchemaSlug: text(),
	propertiesSchema: jsonb().$type<AppSchema>().notNull(),
});

const signalSchemaColumns = () => ({
	notificationHookSlug: text().notNull(),
	propertiesSchema: jsonb().$type<AppSchema>().notNull(),
	audiencePolicy: jsonb().$type<PluginSignalAudiencePolicy>().notNull(),
	catalogState: text().$type<PluginSignalSchema["catalogState"]>().notNull(),
});

const savedViewColumns = () => ({
	icon: text().notNull(),
	sortOrder: integer().notNull(),
	dataSources: jsonb().$type<RyotQLDocument>(),
	settings: jsonb().$type<SavedViewSettings>().notNull(),
	renderer: jsonb().$type<SavedViewRenderer>().notNull(),
});

export const globalEntitySchema = snakeCase
	.view("global_entity_schema", { ...globalColumns(), ...entitySchemaColumns() })
	.as(
		sql`
			select d.id, d.plugin_id, d.plugin_revision_id, g.slug as plugin_slug, d.slug, d.name, d.position, d.icon, d.properties_schema, d.user_state, d.merge_identity_properties
			from definition_entity_schema d
			left join (${globalPluginQuery}) g on g.plugin_id = d.plugin_id and g.active_revision_id = d.plugin_revision_id
			where d.plugin_revision_id is null or g.plugin_id is not null
		`,
	);

export const globalEventSchema = snakeCase.view("global_event_schema", eventSchemaColumns()).as(
	sql`
			select v.id, v.entity_schema_id, e.slug as entity_schema_slug, e.plugin_id, v.slug, v.name, v.position, v.properties_schema
			from ${globalEntitySchema} e
			join definition_event_schema v on v.entity_schema_id = e.id
		`,
);

export const globalRelationshipSchema = snakeCase
	.view("global_relationship_schema", { ...globalColumns(), ...relationshipSchemaColumns() })
	.as(
		sql`
			select d.id, d.plugin_id, d.plugin_revision_id, g.slug as plugin_slug, d.slug, d.name, d.position, d.source_entity_schema_slug, d.target_entity_schema_slug, d.properties_schema
			from definition_relationship_schema d
			left join ${globalPlugin} g on g.plugin_id = d.plugin_id and g.active_revision_id = d.plugin_revision_id
			where d.plugin_revision_id is null or g.plugin_id is not null
		`,
	);

export const globalSignalSchema = snakeCase
	.view("global_signal_schema", { ...globalColumns(), ...signalSchemaColumns() })
	.as(
		sql`
			select d.id, d.plugin_id, d.plugin_revision_id, g.slug as plugin_slug, d.slug, d.name, d.position, d.notification_hook_slug, d.properties_schema, d.audience_policy, d.catalog_state
			from definition_signal_schema d
			left join ${globalPlugin} g on g.plugin_id = d.plugin_id and g.active_revision_id = d.plugin_revision_id
			where d.plugin_revision_id is null or g.plugin_id is not null
		`,
	);

export const globalSavedView = snakeCase
	.view("global_saved_view", { ...globalColumns(), ...savedViewColumns() })
	.as(
		sql`
			select d.id, d.plugin_id, d.plugin_revision_id, g.slug as plugin_slug, d.slug, d.name, d.position, d.icon, d.sort_order, d.data_sources, d.settings, d.renderer
			from definition_saved_view d
			left join ${globalPlugin} g on g.plugin_id = d.plugin_id and g.active_revision_id = d.plugin_revision_id
			where d.plugin_revision_id is null or g.plugin_id is not null
		`,
	);

export const userEntitySchema = snakeCase
	.view("user_entity_schema", { ...userColumns(), ...entitySchemaColumns() })
	.as(
		sql`
			select u.id as user_id, d.id, d.plugin_id, d.plugin_revision_id, null::text as plugin_slug, null::text as plugin_scope, d.slug, d.name, d.position, d.icon, d.properties_schema, d.user_state, d.merge_identity_properties, true as is_effective
			from definition_entity_schema d
			cross join "user" u
			where d.plugin_revision_id is null
			union all
			select p.user_id, d.id, d.plugin_id, d.plugin_revision_id, p.slug, p.scope, d.slug, d.name, d.position, d.icon, d.properties_schema, d.user_state, d.merge_identity_properties, p.is_definition_effective
			from (${userPluginQuery}) p
			join definition_entity_schema d on d.plugin_revision_id = p.active_revision_id
			where p.is_listed and (p.scope = 'system' or not exists (select 1 from ${globalEntitySchema} g where g.slug = d.slug))
		`,
	);

export const userEventSchema = snakeCase
	.view("user_event_schema", {
		...eventSchemaColumns(),
		userId: text().notNull(),
		isEffective: boolean().notNull(),
	})
	.as(
		sql`
			select e.user_id, v.id, v.entity_schema_id, e.slug as entity_schema_slug, e.plugin_id, v.slug, v.name, v.position, v.properties_schema, e.is_effective
			from ${userEntitySchema} e
			join definition_event_schema v on v.entity_schema_id = e.id
		`,
	);

export const userRelationshipSchema = snakeCase
	.view("user_relationship_schema", { ...userColumns(), ...relationshipSchemaColumns() })
	.as(
		sql`
			select u.id as user_id, d.id, d.plugin_id, d.plugin_revision_id, null::text as plugin_slug, null::text as plugin_scope, d.slug, d.name, d.position, d.source_entity_schema_slug, d.target_entity_schema_slug, d.properties_schema, true as is_effective
			from definition_relationship_schema d
			cross join "user" u
			where d.plugin_revision_id is null
			union all
			select p.user_id, d.id, d.plugin_id, d.plugin_revision_id, p.slug, p.scope, d.slug, d.name, d.position, d.source_entity_schema_slug, d.target_entity_schema_slug, d.properties_schema, p.is_definition_effective and (d.source_entity_schema_slug is null or exists (select 1 from ${userEntitySchema} e where e.user_id = p.user_id and e.slug = d.source_entity_schema_slug and e.is_effective)) and (d.target_entity_schema_slug is null or exists (select 1 from ${userEntitySchema} e where e.user_id = p.user_id and e.slug = d.target_entity_schema_slug and e.is_effective))
			from ${userPlugin} p
			join definition_relationship_schema d on d.plugin_revision_id = p.active_revision_id
			where p.is_listed and (p.scope = 'system' or not exists (select 1 from ${globalRelationshipSchema} g where g.slug = d.slug)) and (d.source_entity_schema_slug is null or exists (select 1 from ${userEntitySchema} e where e.user_id = p.user_id and e.slug = d.source_entity_schema_slug)) and (d.target_entity_schema_slug is null or exists (select 1 from ${userEntitySchema} e where e.user_id = p.user_id and e.slug = d.target_entity_schema_slug))
		`,
	);

export const userSignalSchema = snakeCase
	.view("user_signal_schema", { ...userColumns(), ...signalSchemaColumns() })
	.as(
		sql`
			select u.id as user_id, d.id, d.plugin_id, d.plugin_revision_id, null::text as plugin_slug, null::text as plugin_scope, d.slug, d.name, d.position, d.notification_hook_slug, d.properties_schema, d.audience_policy, d.catalog_state, true as is_effective
			from definition_signal_schema d
			cross join "user" u
			where d.plugin_revision_id is null
			union all
			select p.user_id, d.id, d.plugin_id, d.plugin_revision_id, p.slug, p.scope, d.slug, d.name, d.position, d.notification_hook_slug, d.properties_schema, d.audience_policy, d.catalog_state, p.is_definition_effective and (d.audience_policy ->> 'kind' <> 'related_users' or exists (select 1 from ${userRelationshipSchema} r where r.user_id = p.user_id and r.slug = d.audience_policy ->> 'relationshipSchemaSlug' and r.is_effective))
			from ${userPlugin} p
			join definition_signal_schema d on d.plugin_revision_id = p.active_revision_id
			where p.is_listed and (p.scope = 'system' or not exists (select 1 from ${globalSignalSchema} g where g.slug = d.slug)) and (d.audience_policy ->> 'kind' <> 'related_users' or exists (select 1 from ${userRelationshipSchema} r where r.user_id = p.user_id and r.slug = d.audience_policy ->> 'relationshipSchemaSlug'))
		`,
	);

export const userSavedView = snakeCase
	.view("user_saved_view", { ...userColumns(), ...savedViewColumns() })
	.as(
		sql`
			select u.id as user_id, d.id, d.plugin_id, d.plugin_revision_id, null::text as plugin_slug, null::text as plugin_scope, d.slug, d.name, d.position, d.icon, d.sort_order, d.data_sources, d.settings, d.renderer, true as is_effective
			from definition_saved_view d
			cross join "user" u
			where d.plugin_revision_id is null
			union all
			select p.user_id, d.id, d.plugin_id, d.plugin_revision_id, p.slug, p.scope, d.slug, d.name, d.position, d.icon, d.sort_order, d.data_sources, d.settings, d.renderer, p.is_definition_effective
			from ${userPlugin} p
			join definition_saved_view d on d.plugin_revision_id = p.active_revision_id
			where p.is_listed and (p.scope = 'system' or not exists (select 1 from ${globalSavedView} g where g.slug = d.slug))
		`,
	);

const executableDefinitionColumns = () => ({
	id: text().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	userId: text().notNull(),
	configRevisionId: text(),
	pluginId: text().notNull(),
	pluginSlug: text().notNull(),
	position: integer().notNull(),
	description: text().notNull(),
	installationId: text().notNull(),
	pluginRevisionId: text().notNull(),
	pluginScope: text().$type<PluginScope>().notNull(),
});

export const userImportSource = snakeCase
	.view("user_import_source", {
		...executableDefinitionColumns(),
		workflowScriptId: text(),
		workflowSlug: text().notNull(),
		inputSchema: jsonb().$type<AppSchema>().notNull(),
		requiredPluginConfigKeys: text().array().notNull(),
		exportHelp: jsonb().$type<NonNullable<PluginImportSource["exportHelp"]>>(),
	})
	.as(
		sql`
			select p.user_id, d.id, d.plugin_id, d.plugin_revision_id, p.slug as plugin_slug, p.scope as plugin_scope, p.installation_id, p.config_revision_id, d.slug, d.name, d.description, d.position, d.workflow_slug, s.id as workflow_script_id, d.input_schema, d.required_plugin_config_keys, d.export_help
			from ${userPlugin} p
			join definition_import_source d on d.plugin_revision_id = p.active_revision_id
			left join sandbox_script s on s.plugin_revision_id = d.plugin_revision_id and s.slug = d.workflow_script_slug
			where p.is_executable and not exists (select 1 from ${userPlugin} sp join definition_import_source g on g.plugin_revision_id = sp.active_revision_id where sp.user_id = p.user_id and sp.plugin_id <> p.plugin_id and sp.scope = 'system' and sp.is_executable and g.slug = d.slug)
		`,
	);

export const userIntegrationProvider = snakeCase
	.view("user_integration_provider", {
		...executableDefinitionColumns(),
		scriptId: text(),
		scriptSlug: text(),
		requiresProKey: boolean().notNull(),
		settingsSchema: jsonb().$type<AppSchema>().notNull(),
		lot: text().$type<PluginIntegrationProvider["lot"]>().notNull(),
	})
	.as(
		sql`
			select p.user_id, d.id, d.plugin_id, d.plugin_revision_id, p.slug as plugin_slug, p.scope as plugin_scope, p.installation_id, p.config_revision_id, d.slug, d.name, d.description, d.position, d.lot, d.script_slug, s.id as script_id, d.settings_schema, d.requires_pro_key
			from ${userPlugin} p
			join definition_integration_provider d on d.plugin_revision_id = p.active_revision_id
			left join sandbox_script s on s.plugin_revision_id = d.plugin_revision_id and s.slug = d.script_slug
			where p.is_executable and not exists (select 1 from ${userPlugin} sp join definition_integration_provider g on g.plugin_revision_id = sp.active_revision_id where sp.user_id = p.user_id and sp.plugin_id <> p.plugin_id and sp.scope = 'system' and sp.is_executable and g.slug = d.slug)
		`,
	);

export const userSandboxProvider = snakeCase
	.view("user_sandbox_provider", {
		id: text().notNull(),
		slug: text().notNull(),
		name: text().notNull(),
		userId: text().notNull(),
		pluginId: text().notNull(),
		installationId: text().notNull(),
		rootEntitySchemaSlug: text().notNull(),
		pluginScope: text().$type<PluginScope>().notNull(),
		createdAt: timestamp({ withTimezone: true }).notNull(),
		updatedAt: timestamp({ withTimezone: true }).notNull(),
		information: jsonb().$type<ProviderInformation>().notNull(),
	})
	.as(
		sql`
			select p.user_id, s.id, s.plugin_id, p.scope as plugin_scope, p.installation_id, s.slug, s.name, s.root_entity_schema_slug, s.information, s.created_at, s.updated_at
			from ${userPlugin} p
			join sandbox_provider s on s.plugin_id = p.plugin_id
			join plugin_revision r on r.id = p.active_revision_id
			where p.is_executable and exists (select 1 from jsonb_array_elements(r.manifest -> 'providers') m where m ->> 'slug' = s.slug) and exists (select 1 from ${userEntitySchema} e where e.user_id = p.user_id and e.slug = s.root_entity_schema_slug and e.is_effective)
		`,
	);
