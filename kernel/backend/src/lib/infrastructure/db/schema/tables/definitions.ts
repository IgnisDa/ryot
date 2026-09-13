import {
	dataJsonImportInputSchema,
	dataJsonIntegrationSettingsSchema,
} from "@ryot-app/contract/modules/imports/data-json";
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
	index,
	integer,
	jsonb,
	snakeCase,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin, pluginInstallation, pluginRevision } from "./core";
import { savedView, savedViewOverride } from "./views";

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
		icon: text().notNull(),
		mergeIdentityProperties: text().array().notNull(),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		userState: jsonb().$type<PluginEntityUserStatePolicy>(),
		pluginRevisionId: text().references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [
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
		sourceEntitySchemaSlug: text(),
		targetEntitySchemaSlug: text(),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		pluginRevisionId: text().references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [
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
		notificationHookSlug: text().notNull(),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		audiencePolicy: jsonb().$type<PluginSignalAudiencePolicy>().notNull(),
		catalogState: text().$type<PluginSignalSchema["catalogState"]>().notNull(),
		pluginRevisionId: text().references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [
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
		icon: text().notNull(),
		sortOrder: integer().notNull(),
		dataSources: jsonb().$type<RyotQLDocument>(),
		settings: jsonb().$type<SavedViewSettings>().notNull(),
		renderer: jsonb().$type<SavedViewRenderer>().notNull(),
		pluginRevisionId: text().references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [
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
		workflowScriptSlug: text(),
		description: text().notNull(),
		workflowSlug: text().notNull(),
		inputSchema: jsonb().$type<AppSchema>().notNull(),
		requiredPluginConfigKeys: text().array().notNull(),
		exportHelp: jsonb().$type<NonNullable<PluginImportSource["exportHelp"]>>(),
		pluginRevisionId: text()
			.notNull()
			.references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("definition_import_source_revision_slug_unique").on(table.pluginRevisionId, table.slug),
		index("definition_import_source_slug_idx").on(table.slug),
	],
);

export const definitionIntegrationProvider = snakeCase.table(
	"definition_integration_provider",
	{
		...definitionColumns(),
		scriptSlug: text(),
		description: text().notNull(),
		requiresProKey: boolean().notNull(),
		settingsSchema: jsonb().$type<AppSchema>().notNull(),
		supportsOwnershipSync: boolean().notNull().default(false),
		lot: text().$type<PluginIntegrationProvider["lot"]>().notNull(),
		pluginRevisionId: text()
			.notNull()
			.references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [
		check(
			"definition_integration_provider_script_check",
			sql`(${table.lot} = 'push') = (${table.scriptSlug} is null)`,
		),
		unique("definition_integration_provider_revision_slug_unique").on(
			table.pluginRevisionId,
			table.slug,
		),
		index("definition_integration_provider_slug_idx").on(table.slug),
	],
);

const globalPluginQuery = sql`
 select p.id as plugin_id, p.slug, p.active_revision_id, p.environment_config_revision_id as config_revision_id, coalesce(c.owner_user_id is null and c.encrypted_payload is not null, false) as is_executable
	from plugin p
	left join plugin_config_revision c on c.id = p.environment_config_revision_id
	where p.owner_user_id is null and p.status = 'active'
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
	select i.user_id, p.id as plugin_id, i.id as installation_id, p.slug, case when p.owner_user_id is null then 'system' else 'user' end as scope, p.owner_user_id, p.active_revision_id, case when p.owner_user_id is null then p.environment_config_revision_id else i.active_config_revision_id end as config_revision_id, i.health, i.is_hidden, i.sort_order, i.health <> 'incompatible' as is_listed, not i.is_hidden and (i.health = 'ready' or (p.owner_user_id is null and i.health = 'installing')) as is_definition_effective, coalesce(not i.is_hidden and i.health = 'ready' and c.plugin_revision_id = p.active_revision_id and c.encrypted_payload is not null and case when p.owner_user_id is null then c.owner_user_id is null else c.owner_user_id = i.user_id and c.plugin_installation_id = i.id end, false) as is_executable
	from plugin_installation i
	join plugin p on p.id = i.plugin_id
	left join plugin_config_revision c on c.id = case when p.owner_user_id is null then p.environment_config_revision_id else i.active_config_revision_id end
	where i.uninstalled_at is null and p.status = 'active' and (p.owner_user_id is null or p.owner_user_id = i.user_id)
`;

export const userPlugin = snakeCase
	.view("user_plugin", {
		ownerUserId: text(),
		slug: text().notNull(),
		userId: text().notNull(),
		configRevisionId: text(),
		pluginId: text().notNull(),
		isListed: boolean().notNull(),
		isHidden: boolean().notNull(),
		sortOrder: integer().notNull(),
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
			select d.id, r.plugin_id, d.plugin_revision_id, g.slug as plugin_slug, d.slug, d.name, d.position, d.icon, d.properties_schema, d.user_state, d.merge_identity_properties
			from definition_entity_schema d
			left join plugin_revision r on r.id = d.plugin_revision_id
			left join (${globalPluginQuery}) g on g.plugin_id = r.plugin_id and g.active_revision_id = d.plugin_revision_id
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
			select d.id, r.plugin_id, d.plugin_revision_id, g.slug as plugin_slug, d.slug, d.name, d.position, d.source_entity_schema_slug, d.target_entity_schema_slug, d.properties_schema
			from definition_relationship_schema d
			left join plugin_revision r on r.id = d.plugin_revision_id
			left join ${globalPlugin} g on g.plugin_id = r.plugin_id and g.active_revision_id = d.plugin_revision_id
			where d.plugin_revision_id is null or g.plugin_id is not null
		`,
	);

export const globalSignalSchema = snakeCase
	.view("global_signal_schema", { ...globalColumns(), ...signalSchemaColumns() })
	.as(
		sql`
			select d.id, r.plugin_id, d.plugin_revision_id, g.slug as plugin_slug, d.slug, d.name, d.position, d.notification_hook_slug, d.properties_schema, d.audience_policy, d.catalog_state
			from definition_signal_schema d
			left join plugin_revision r on r.id = d.plugin_revision_id
			left join ${globalPlugin} g on g.plugin_id = r.plugin_id and g.active_revision_id = d.plugin_revision_id
			where d.plugin_revision_id is null or g.plugin_id is not null
		`,
	);

export const globalSavedView = snakeCase
	.view("global_saved_view", { ...globalColumns(), ...savedViewColumns() })
	.as(
		sql`
			select d.id, r.plugin_id, d.plugin_revision_id, g.slug as plugin_slug, d.slug, d.name, d.position, d.icon, d.sort_order, d.data_sources, d.settings, d.renderer
			from definition_saved_view d
			left join plugin_revision r on r.id = d.plugin_revision_id
			left join ${globalPlugin} g on g.plugin_id = r.plugin_id and g.active_revision_id = d.plugin_revision_id
			where d.plugin_revision_id is null or g.plugin_id is not null
		`,
	);

export const userEntitySchema = snakeCase
	.view("user_entity_schema", { ...userColumns(), ...entitySchemaColumns() })
	.as(
		sql`
			select u.id as user_id, d.id, null::text as plugin_id, d.plugin_revision_id, null::text as plugin_slug, null::text as plugin_scope, d.slug, d.name, d.position, d.icon, d.properties_schema, d.user_state, d.merge_identity_properties, true as is_effective
			from definition_entity_schema d
			cross join "user" u
			where d.plugin_revision_id is null
			union all
			select p.user_id, d.id, p.plugin_id, d.plugin_revision_id, p.slug, p.scope, d.slug, d.name, d.position, d.icon, d.properties_schema, d.user_state, d.merge_identity_properties, p.is_definition_effective
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
			select u.id as user_id, d.id, null::text as plugin_id, d.plugin_revision_id, null::text as plugin_slug, null::text as plugin_scope, d.slug, d.name, d.position, d.source_entity_schema_slug, d.target_entity_schema_slug, d.properties_schema, true as is_effective
			from definition_relationship_schema d
			cross join "user" u
			where d.plugin_revision_id is null
			union all
			select p.user_id, d.id, p.plugin_id, d.plugin_revision_id, p.slug, p.scope, d.slug, d.name, d.position, d.source_entity_schema_slug, d.target_entity_schema_slug, d.properties_schema, p.is_definition_effective and (d.source_entity_schema_slug is null or exists (select 1 from ${userEntitySchema} e where e.user_id = p.user_id and e.slug = d.source_entity_schema_slug and e.is_effective)) and (d.target_entity_schema_slug is null or exists (select 1 from ${userEntitySchema} e where e.user_id = p.user_id and e.slug = d.target_entity_schema_slug and e.is_effective))
			from ${userPlugin} p
			join definition_relationship_schema d on d.plugin_revision_id = p.active_revision_id
			where p.is_listed and (p.scope = 'system' or not exists (select 1 from ${globalRelationshipSchema} g where g.slug = d.slug)) and (d.source_entity_schema_slug is null or exists (select 1 from ${userEntitySchema} e where e.user_id = p.user_id and e.slug = d.source_entity_schema_slug)) and (d.target_entity_schema_slug is null or exists (select 1 from ${userEntitySchema} e where e.user_id = p.user_id and e.slug = d.target_entity_schema_slug))
		`,
	);

export const userSignalSchema = snakeCase
	.view("user_signal_schema", { ...userColumns(), ...signalSchemaColumns() })
	.as(
		sql`
			select u.id as user_id, d.id, null::text as plugin_id, d.plugin_revision_id, null::text as plugin_slug, null::text as plugin_scope, d.slug, d.name, d.position, d.notification_hook_slug, d.properties_schema, d.audience_policy, d.catalog_state, true as is_effective
			from definition_signal_schema d
			cross join "user" u
			where d.plugin_revision_id is null
			union all
			select p.user_id, d.id, p.plugin_id, d.plugin_revision_id, p.slug, p.scope, d.slug, d.name, d.position, d.notification_hook_slug, d.properties_schema, d.audience_policy, d.catalog_state, p.is_definition_effective and (d.audience_policy ->> 'kind' <> 'related_users' or exists (select 1 from ${userRelationshipSchema} r where r.user_id = p.user_id and r.slug = d.audience_policy ->> 'relationshipSchemaSlug' and r.is_effective))
			from ${userPlugin} p
			join definition_signal_schema d on d.plugin_revision_id = p.active_revision_id
			where p.is_listed and (p.scope = 'system' or not exists (select 1 from ${globalSignalSchema} g where g.slug = d.slug)) and (d.audience_policy ->> 'kind' <> 'related_users' or exists (select 1 from ${userRelationshipSchema} r where r.user_id = p.user_id and r.slug = d.audience_policy ->> 'relationshipSchemaSlug'))
		`,
	);

export const userSavedView = snakeCase
	.view("user_saved_view", { ...userColumns(), ...savedViewColumns() })
	.as(
		sql`
			select u.id as user_id, d.id, null::text as plugin_id, d.plugin_revision_id, null::text as plugin_slug, null::text as plugin_scope, d.slug, d.name, d.position, d.icon, d.sort_order, d.data_sources, d.settings, d.renderer, true as is_effective
			from definition_saved_view d
			cross join "user" u
			where d.plugin_revision_id is null
			union all
			select p.user_id, d.id, p.plugin_id, d.plugin_revision_id, p.slug, p.scope, d.slug, d.name, d.position, d.icon, d.sort_order, d.data_sources, d.settings, d.renderer, p.is_definition_effective
			from ${userPlugin} p
			join definition_saved_view d on d.plugin_revision_id = p.active_revision_id
			where p.is_listed and (p.scope = 'system' or not exists (select 1 from ${globalSavedView} g where g.slug = d.slug))
		`,
	);

export const userSavedViewEffective = snakeCase.view("user_saved_view_effective", {
	pluginId: text(),
	pluginSlug: text(),
	id: text().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	icon: text().notNull(),
	userId: text().notNull(),
	pluginInstallationId: text(),
	revision: integer().notNull(),
	isHidden: boolean().notNull(),
	sortOrder: integer().notNull(),
	isBuiltin: boolean().notNull(),
	dataSources: jsonb().$type<RyotQLDocument>(),
	createdAt: timestamp({ withTimezone: true }),
	updatedAt: timestamp({ withTimezone: true }),
	renderer: jsonb().$type<SavedViewRenderer>().notNull(),
	settings: jsonb().$type<Readonly<Record<string, JsonValue>>>().notNull(),
}).as(sql`
	select s.id, null::text as plugin_id, custom_plugin.slug as plugin_slug,
		s.user_id, s.slug, s.name, s.icon, s.plugin_installation_id,
		s.revision, s.sort_order, s.data_sources, false as is_builtin,
		s.is_hidden, s.renderer, s.created_at, s.settings, s.updated_at
	from ${savedView} s
	left join ${pluginInstallation} custom_installation on custom_installation.id = s.plugin_installation_id
	left join ${plugin} custom_plugin on custom_plugin.id = custom_installation.plugin_id
	union all
	select 'builtin:' || d.user_id || ':' || d.slug as id, d.plugin_id, d.plugin_slug,
		d.user_id, d.slug, d.name, d.icon, p.installation_id as plugin_installation_id,
		hashtext(d.id || ':' || coalesce(o.revision, 0)::text) as revision,
		coalesce(o.sort_order, d.sort_order) as sort_order, d.data_sources, true as is_builtin,
		coalesce(o.is_hidden, false) as is_hidden, d.renderer,
		null::timestamptz as created_at, d.settings, null::timestamptz as updated_at
	from ${userSavedView} d
	left join ${userPlugin} p on p.user_id = d.user_id and p.plugin_id = d.plugin_id
	left join ${savedViewOverride} o on o.user_id = d.user_id and o.slug = d.slug
		and o.plugin_id is not distinct from d.plugin_id
`);

const executableDefinitionColumns = () => ({
	pluginId: text(),
	pluginSlug: text(),
	id: text().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	installationId: text(),
	pluginRevisionId: text(),
	userId: text().notNull(),
	configRevisionId: text(),
	position: integer().notNull(),
	description: text().notNull(),
	pluginScope: text().$type<PluginScope>(),
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
			select p.user_id, d.id, p.plugin_id, d.plugin_revision_id, p.slug as plugin_slug, p.scope as plugin_scope, p.installation_id, p.config_revision_id, d.slug, d.name, d.description, d.position, d.workflow_slug, s.id as workflow_script_id, d.input_schema, d.required_plugin_config_keys, d.export_help
			from ${userPlugin} p
			join definition_import_source d on d.plugin_revision_id = p.active_revision_id
			left join sandbox_script s on s.plugin_revision_id = d.plugin_revision_id and s.slug = d.workflow_script_slug
			where p.is_executable and not exists (select 1 from ${userPlugin} sp join definition_import_source g on g.plugin_revision_id = sp.active_revision_id where sp.user_id = p.user_id and sp.plugin_id <> p.plugin_id and sp.scope = 'system' and sp.is_executable and g.slug = d.slug)
			union all
			select u.id, 'kernel:data-json:' || u.id, null::text, null::text, null::text, null::text, null::text, null::text, 'data-json', 'Data import', 'Import generic entities, relationships, and events from JSON.', 0, 'data-json', null::text, ${sql.raw(`'${JSON.stringify(dataJsonImportInputSchema).replaceAll("'", "''")}'::jsonb`)}, '{}'::text[], null::jsonb
			from ${user} u
		`,
	);

export const userIntegrationProvider = snakeCase
	.view("user_integration_provider", {
		...executableDefinitionColumns(),
		scriptId: text(),
		scriptSlug: text(),
		requiresProKey: boolean().notNull(),
		supportsOwnershipSync: boolean().notNull(),
		settingsSchema: jsonb().$type<AppSchema>().notNull(),
		lot: text().$type<PluginIntegrationProvider["lot"]>().notNull(),
	})
	.as(
		sql`
			select p.user_id, d.id, p.plugin_id, d.plugin_revision_id, p.slug as plugin_slug, p.scope as plugin_scope, p.installation_id, p.config_revision_id, d.slug, d.name, d.description, d.position, d.lot, d.script_slug, s.id as script_id, d.settings_schema, d.requires_pro_key, d.supports_ownership_sync
			from ${userPlugin} p
			join definition_integration_provider d on d.plugin_revision_id = p.active_revision_id
			left join sandbox_script s on s.plugin_revision_id = d.plugin_revision_id and s.slug = d.script_slug
			where p.is_executable and not exists (select 1 from ${userPlugin} sp join definition_integration_provider g on g.plugin_revision_id = sp.active_revision_id where sp.user_id = p.user_id and sp.plugin_id <> p.plugin_id and sp.scope = 'system' and sp.is_executable and g.slug = d.slug)
			union all
			select u.id, 'kernel:data-json:' || u.id, null::text, null::text, null::text, null::text, null::text, null::text, 'data-json', 'Data webhook', 'Receive generic entities, relationships, and events as JSON.', 0, 'sink', null::text, null::text, ${sql.raw(`'${JSON.stringify(dataJsonIntegrationSettingsSchema).replaceAll("'", "''")}'::jsonb`)}, false, false
			from ${user} u
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

export const userSandboxProviderOperation = snakeCase.view("user_sandbox_provider_operation", {
	userId: text().notNull(),
	operation: text().notNull(),
	providerId: text().notNull(),
	optionsSchema: jsonb().$type<AppSchema>(),
}).as(sql`
		select provider.user_id, provider.id as provider_id,
			case when operation.key = 'searchOptions' then 'search-options' else operation.key end as operation,
			case when operation.key = 'search' then script.metadata -> 'searchOptionsSchema' else null end as options_schema
		from ${userSandboxProvider} provider
		join plugin p on p.id = provider.plugin_id
		join plugin_revision r on r.id = p.active_revision_id
		join lateral jsonb_array_elements(r.manifest -> 'providers') as definition(value) on definition.value ->> 'slug' = provider.slug
		join lateral jsonb_each_text(definition.value -> 'operations') as operation(key, value) on true
		join sandbox_script script on script.plugin_revision_id = r.id
			and script.slug = operation.value and script.provider_id = provider.id
			and script.metadata ->> 'kind' = 'provider'
			and script.metadata ->> 'providerOperation' = case when operation.key = 'searchOptions' then 'search-options' else operation.key end
	`);
