import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { type SQL, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import * as schema from "#schema/tables/combined";
import { builtinSavedViewIdSql } from "#schema/tables/views";

import type {
	CatalogImportSource,
	CatalogIntegrationProvider,
	CatalogSandboxProvider,
	CatalogSandboxProviderOperation,
	DefinitionCatalog,
	PluginScope,
	UserCatalog,
	UserPlugin,
} from "./catalog";

const catalogRelationNames = [
	"user_plugin",
	"user_entity_schema",
	"user_event_schema",
	"user_signal_schema",
	"user_import_source",
	"user_sandbox_provider",
	"user_relationship_schema",
	"user_saved_view_effective",
	"user_integration_provider",
	"user_calendar_source_effective",
	"user_sandbox_provider_operation",
] as const;

export type CatalogRelationName = (typeof catalogRelationNames)[number];

const referencePattern = new RegExp(`\\b(${catalogRelationNames.join("|")})\\b`, "g");

export const referencedCatalogRelations = (statement: string): ReadonlySet<string> =>
	new Set(Array.from(statement.matchAll(referencePattern), ([name]) => name));

const elements = (rows: ReadonlyArray<object>) =>
	sql`jsonb_array_elements(${JSON.stringify(rows)}::jsonb) as k(row)`;

const text = (key: string, column: string) => sql<string>`(k.row ->> ${key})`.as(column);
const optionalText = (key: string, column: string) =>
	sql<null | string>`(k.row ->> ${key})`.as(column);
const literal = <T extends null | string>(key: string, column: string) =>
	sql<T>`(k.row ->> ${key})`.as(column);
const flag = (key: string, column: string) => sql<boolean>`(k.row ->> ${key})::boolean`.as(column);
const integer = (key: string, column: string) =>
	sql<number>`(k.row ->> ${key})::integer`.as(column);
const json = <T>(key: string, column: string) =>
	sql<T>`nullif(k.row -> ${key}, 'null'::jsonb)`.as(column);
const textArray = (key: string, column: string) =>
	sql<ReadonlyArray<string>>`array(select jsonb_array_elements_text(k.row -> ${key}))`.as(column);

export const userPluginQuery = (plugins: ReadonlyArray<UserPlugin>) =>
	new QueryBuilder()
		.select({
			userId: text("userId", "user_id"),
			pluginId: text("pluginId", "plugin_id"),
			isHidden: flag("isHidden", "is_hidden"),
			isListed: flag("isListed", "is_listed"),
			scope: literal<PluginScope>("scope", "scope"),
			sortOrder: integer("sortOrder", "sort_order"),
			isExecutable: flag("isExecutable", "is_executable"),
			installationId: text("installationId", "installation_id"),
			ownerUserId: optionalText("ownerUserId", "owner_user_id"),
			health: literal<UserPlugin["health"]>("health", "health"),
			packageId: literal<PluginPackageId>("packageId", "package_id"),
			activeRevisionId: text("activeRevisionId", "active_revision_id"),
			configRevisionId: optionalText("configRevisionId", "config_revision_id"),
			isDefinitionEffective: flag("isDefinitionEffective", "is_definition_effective"),
		})
		.from(elements(plugins));

const executable = () => ({
	id: text("id", "id"),
	slug: text("slug", "slug"),
	name: text("name", "name"),
	userId: text("userId", "user_id"),
	position: integer("position", "position"),
	description: text("description", "description"),
	pluginId: optionalText("pluginId", "plugin_id"),
	installationId: optionalText("installationId", "installation_id"),
	packageId: literal<null | PluginPackageId>("packageId", "package_id"),
	pluginScope: literal<null | PluginScope>("pluginScope", "plugin_scope"),
	configRevisionId: optionalText("configRevisionId", "config_revision_id"),
	pluginRevisionId: optionalText("pluginRevisionId", "plugin_revision_id"),
});

export const importSourceQuery = (rows: ReadonlyArray<CatalogImportSource>) =>
	new QueryBuilder()
		.select({
			...executable(),
			workflowSlug: text("workflowSlug", "workflow_slug"),
			plan: json<CatalogImportSource["plan"]>("plan", "plan"),
			workflowScriptId: optionalText("workflowScriptId", "workflow_script_id"),
			exportHelp: json<CatalogImportSource["exportHelp"]>("exportHelp", "export_help"),
			inputSchema: json<CatalogImportSource["inputSchema"]>("inputSchema", "input_schema"),
			requiredPluginConfigKeys: textArray(
				"requiredPluginConfigKeys",
				"required_plugin_config_keys",
			),
		})
		.from(elements(rows));

export const integrationProviderQuery = (rows: ReadonlyArray<CatalogIntegrationProvider>) =>
	new QueryBuilder()
		.select({
			...executable(),
			scriptId: optionalText("scriptId", "script_id"),
			scriptSlug: optionalText("scriptSlug", "script_slug"),
			requiresProKey: flag("requiresProKey", "requires_pro_key"),
			lot: literal<CatalogIntegrationProvider["lot"]>("lot", "lot"),
			plan: json<CatalogIntegrationProvider["plan"]>("plan", "plan"),
			supportsOwnershipSync: flag("supportsOwnershipSync", "supports_ownership_sync"),
			settingsSchema: json<CatalogIntegrationProvider["settingsSchema"]>(
				"settingsSchema",
				"settings_schema",
			),
		})
		.from(elements(rows));

const sandboxProviderQuery = (rows: ReadonlyArray<CatalogSandboxProvider>) =>
	new QueryBuilder()
		.select({
			id: text("id", "id"),
			slug: text("slug", "slug"),
			name: text("name", "name"),
			userId: text("userId", "user_id"),
			pluginId: text("pluginId", "plugin_id"),
			installationId: text("installationId", "installation_id"),
			packageId: literal<PluginPackageId>("packageId", "package_id"),
			pluginScope: literal<PluginScope>("pluginScope", "plugin_scope"),
			rootEntitySchemaSlug: text("rootEntitySchemaSlug", "root_entity_schema_slug"),
			information: json<CatalogSandboxProvider["information"]>("information", "information"),
			createdAt: sql`(k.row ->> 'createdAt')::timestamptz`
				.mapWith(schema.sandboxProvider.createdAt)
				.as("created_at"),
			updatedAt: sql`(k.row ->> 'updatedAt')::timestamptz`
				.mapWith(schema.sandboxProvider.updatedAt)
				.as("updated_at"),
		})
		.from(elements(rows));

const sandboxProviderOperationQuery = (rows: ReadonlyArray<CatalogSandboxProviderOperation>) =>
	new QueryBuilder()
		.select({
			userId: text("userId", "user_id"),
			pluginId: text("pluginId", "plugin_id"),
			operation: text("operation", "operation"),
			providerId: text("providerId", "provider_id"),
			packageId: literal<PluginPackageId>("packageId", "package_id"),
			optionsSchema: json<AppSchema>("optionsSchema", "options_schema"),
		})
		.from(elements(rows));

type DefinitionKey = {
	readonly id: string;
	readonly isEffective: boolean;
	readonly userId: null | string;
	readonly pluginId: null | string;
	readonly packageId: null | string;
	readonly pluginScope: null | PluginScope;
};

const keyOf = (key: DefinitionKey) => ({
	id: key.id,
	userId: key.userId,
	pluginId: key.pluginId,
	packageId: key.packageId,
	pluginScope: key.pluginScope,
	isEffective: key.isEffective,
});

const ownerColumns =
	sql.raw(`k.row ->> 'pluginId' as plugin_id, k.row ->> 'packageId' as package_id,
	k.row ->> 'pluginScope' as plugin_scope, (k.row ->> 'isEffective')::boolean as is_effective`);

/**
 * Definition keys joined to their table. A key without a user applies to every user, as kernel definitions do
 * when a relation spans all users.
 */
const definitionRelation = (
	table: string,
	keys: ReadonlyArray<object & DefinitionKey>,
	extra: SQL = sql``,
) => {
	const everyUser = keys.some(({ userId }) => userId === null);
	return sql`(select d.*, ${sql.raw(everyUser ? "u.id" : "k.row ->> 'userId'")} as user_id, ${ownerColumns}${extra}
		from ${elements(keys)}
		join ${sql.identifier(table)} d on d.id = k.row ->> 'id'${
			everyUser
				? sql` join "user" u on k.row ->> 'userId' is null or u.id = k.row ->> 'userId'`
				: sql``
		})`;
};

const eventSchemaRelation = (
	rows: ReadonlyArray<
		DefinitionKey & { readonly entitySchemaSlug: string; readonly pluginRevisionId: null | string }
	>,
) =>
	definitionRelation(
		"definition_event_schema",
		rows.map((row) => ({
			...keyOf(row),
			entitySchemaSlug: row.entitySchemaSlug,
			pluginRevisionId: row.pluginRevisionId,
		})),
		sql`, k.row ->> 'entitySchemaSlug' as entity_schema_slug, k.row ->> 'pluginRevisionId' as plugin_revision_id`,
	);

/** A built-in saved view's revision: it changes when its definition or the user's override does. */
export const builtinSavedViewRevision = (definitionId: string, overrideRevision: number) => {
	let hash = 0x81_1c_9d_c5;
	for (let index = 0; index < definitionId.length; index += 1) {
		hash = Math.imul(hash ^ definitionId.charCodeAt(index), 0x01_00_01_93);
	}
	return ((hash >>> 0) & 0x3f_ff_ff_ff) + overrideRevision;
};

/** A catalog whose rows belong to `userId`, or to every user when it is null. */
type ScopedCatalog = { readonly catalog: UserCatalog; readonly userId: null | string };

const userOf = (scoped: ReadonlyArray<ScopedCatalog>) =>
	scoped.some(({ userId }) => userId === null)
		? {
				id: sql`coalesce(k.row ->> 'userId', u.id)`,
				join: sql` join "user" u on k.row ->> 'userId' is null or u.id = k.row ->> 'userId'`,
			}
		: { join: sql``, id: sql`(k.row ->> 'userId')` };

const savedViewEffective = (scoped: ReadonlyArray<ScopedCatalog>, customUserId: null | string) => {
	const keys = scoped.flatMap(({ userId, catalog }) => {
		const installations = new Map(
			catalog.plugins.map((plugin) => [plugin.pluginId, plugin.installationId]),
		);
		return catalog.savedViews.map((view) => ({
			...keyOf({ ...view, userId }),
			definitionRevision: builtinSavedViewRevision(view.id, 0),
			installationId: view.pluginId === null ? null : (installations.get(view.pluginId) ?? null),
		}));
	});
	const user = userOf(scoped);
	return sql`(select s.id, null::text as plugin_id, custom_plugin.package_id, s.user_id, s.slug, s.name, s.icon,
			s.plugin_installation_id, s.revision, s.sort_order, s.data_sources, false as is_builtin, s.is_hidden,
			s.renderer, s.created_at, s.settings, s.updated_at
		from saved_view s
		left join plugin_installation custom_installation on custom_installation.id = s.plugin_installation_id
		left join plugin custom_plugin on custom_plugin.id = custom_installation.plugin_id
		where ${customUserId === null ? sql`true` : sql`s.user_id = ${customUserId}`}
		union all
		select ${builtinSavedViewIdSql(user.id, sql`(k.row ->> 'pluginId')`, sql`d.slug`)} as id,
			k.row ->> 'pluginId' as plugin_id, k.row ->> 'packageId' as package_id, ${user.id} as user_id,
			d.slug, d.name, d.icon, k.row ->> 'installationId' as plugin_installation_id,
			(k.row ->> 'definitionRevision')::integer + coalesce(o.revision, 0) as revision,
			coalesce(o.sort_order, d.sort_order) as sort_order, d.data_sources, true as is_builtin,
			coalesce(o.is_hidden, false) as is_hidden, d.renderer, null::timestamptz as created_at, d.settings,
			null::timestamptz as updated_at
		from ${elements(keys)}
		join definition_saved_view d on d.id = k.row ->> 'id'${user.join}
		left join saved_view_override o on o.user_id = ${user.id} and o.slug = d.slug
			and o.plugin_id is not distinct from k.row ->> 'pluginId')`;
};

const calendarSourceEffective = (scoped: ReadonlyArray<ScopedCatalog>) =>
	sql`(select d.*, k.row ->> 'userId' as user_id, ${ownerColumns}, coalesce(o.is_hidden, false) as is_hidden
		from ${elements(scoped.flatMap(({ userId, catalog }) => catalog.calendarSources.map((source) => keyOf({ ...source, userId }))))}
		join definition_calendar_source d on d.id = k.row ->> 'id'
		left join calendar_source_override o on o.user_id = k.row ->> 'userId'
			and o.plugin_id = k.row ->> 'pluginId' and o.slug = d.slug)`;

type SandboxProviders = {
	readonly providers: ReadonlyArray<CatalogSandboxProvider>;
	readonly operations: ReadonlyArray<CatalogSandboxProviderOperation>;
};

const parenthesized = (query: { readonly getSQL: () => SQL }) => sql`(${query.getSQL()})`;

/**
 * Catalogs as the relations RyotQL and raw SQL read, keyed by relation name. Custom saved views are those of
 * `customUserId`, or of every user when it is null.
 */
const catalogRelations = (
	scoped: ReadonlyArray<ScopedCatalog>,
	customUserId: null | string,
	names: ReadonlySet<string>,
	sandbox: SandboxProviders,
) => {
	const relations: Array<readonly [CatalogRelationName, SQL]> = [];
	const add = (name: CatalogRelationName, relation: () => SQL) => {
		if (names.has(name)) {
			relations.push([name, relation()]);
		}
	};
	const keys = <T extends Omit<DefinitionKey, "userId">>(
		rows: (catalog: UserCatalog) => ReadonlyArray<T>,
	) =>
		scoped.flatMap(({ userId, catalog }) =>
			rows(catalog).map((row) => Object.assign({}, row, { userId })),
		);
	add("user_plugin", () =>
		parenthesized(userPluginQuery(scoped.flatMap(({ catalog }) => catalog.plugins))),
	);
	add("user_entity_schema", () =>
		definitionRelation(
			"definition_entity_schema",
			keys(({ entitySchemas }) => entitySchemas).map(keyOf),
		),
	);
	add("user_event_schema", () => eventSchemaRelation(keys(({ eventSchemas }) => eventSchemas)));
	add("user_relationship_schema", () =>
		definitionRelation(
			"definition_relationship_schema",
			keys(({ relationshipSchemas }) => relationshipSchemas).map(keyOf),
		),
	);
	add("user_signal_schema", () =>
		definitionRelation(
			"definition_signal_schema",
			keys(({ signalSchemas }) => signalSchemas).map(keyOf),
		),
	);
	add("user_saved_view_effective", () => savedViewEffective(scoped, customUserId));
	add("user_calendar_source_effective", () => calendarSourceEffective(scoped));
	add("user_import_source", () =>
		parenthesized(importSourceQuery(scoped.flatMap(({ catalog }) => catalog.importSources))),
	);
	add("user_integration_provider", () =>
		parenthesized(
			integrationProviderQuery(scoped.flatMap(({ catalog }) => catalog.integrationProviders)),
		),
	);
	add("user_sandbox_provider", () => parenthesized(sandboxProviderQuery(sandbox.providers)));
	add("user_sandbox_provider_operation", () =>
		parenthesized(sandboxProviderOperationQuery(sandbox.operations)),
	);
	return relations;
};

export const withCatalogRelations = (
	relations: ReadonlyArray<readonly [CatalogRelationName, SQL]>,
	statement: SQL,
) =>
	relations.length === 0
		? statement
		: sql`with ${sql.join(
				relations.map(([name, relation]) => sql`${sql.identifier(name)} as ${relation}`),
				sql`, `,
			)} select * from (${statement}) catalog_statement`;

/** Loads the catalog relations `names` lists, for one user or, with a null user, for every user. */
export const loadCatalogRelations = Effect.fn("loadCatalogRelations")(function* (
	catalogs: DefinitionCatalog["Service"],
	userId: null | string,
	names: ReadonlySet<string>,
) {
	if (names.size === 0) {
		return [];
	}
	const scoped: ReadonlyArray<ScopedCatalog> =
		userId === null
			? yield* Effect.map(catalogs.allUsers(), ({ users, kernel }) => [
					{ userId: null, catalog: kernel },
					...users.map((catalog) => ({ catalog, userId: catalog.userId })),
				])
			: [{ userId, catalog: yield* catalogs.forUser(userId) }];
	const sandbox = {
		providers: new Array<CatalogSandboxProvider>(),
		operations: new Array<CatalogSandboxProviderOperation>(),
	};
	if (names.has("user_sandbox_provider") || names.has("user_sandbox_provider_operation")) {
		for (const { catalog } of scoped) {
			const resolved = yield* catalogs.sandboxProviders(catalog);
			sandbox.providers.push(...resolved.providers);
			sandbox.operations.push(...resolved.operations);
		}
	}
	return catalogRelations(scoped, userId, names, sandbox);
});
