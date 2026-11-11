import type { EntitySchemaBrowse } from "@ryot-app/contract/modules/filters/browse";
import type { Filter } from "@ryot-app/contract/modules/filters/schemas";
import type { PluginEventGroup } from "@ryot-app/contract/modules/plugins/event-groups";
import type { SourcePlan } from "@ryot-app/contract/modules/plugins/execution";
import type {
	PluginEntityEditor,
	PluginEntityFold,
	PluginEntityUserStatePolicy,
	PluginImportSource,
	PluginIntegrationProvider,
	PluginProjection,
	PluginRelationshipRetention,
	PluginRelationshipUserWritePolicy,
	PluginSignalAudiencePolicy,
	PluginSignalSchedule,
	PluginSignalSchema,
} from "@ryot-app/contract/modules/plugins/manifest";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type {
	RowSourcePrecision,
	RowSourceQuery,
} from "@ryot-app/contract/modules/ryotql/row-source";
import type {
	SavedViewRenderer,
	SavedViewSubject,
} from "@ryot-app/contract/modules/saved-views/schemas";
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
	primaryKey,
	snakeCase,
	text,
	unique,
} from "drizzle-orm/pg-core";

import { pluginRevision } from "./core";

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
		occursAtProperty: text(),
		refreshIntervalDays: integer(),
		fold: jsonb().$type<PluginEntityFold>(),
		browse: jsonb().$type<EntitySchemaBrowse>(),
		editor: jsonb().$type<PluginEntityEditor>(),
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

/** An instance admin's replacement for a schema's declared refresh interval; outlives plugin revisions. */
export const entitySchemaRefreshOverride = snakeCase.table(
	"entity_schema_refresh_override",
	{ slug: text().notNull(), pluginId: text().notNull(), refreshIntervalDays: integer().notNull() },
	(table) => [primaryKey({ columns: [table.pluginId, table.slug] })],
);

export const definitionEventSchema = snakeCase.table(
	"definition_event_schema",
	{
		...definitionColumns(),
		eventGroup: jsonb().$type<PluginEventGroup>(),
		projection: jsonb().$type<PluginProjection>(),
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
		projection: jsonb().$type<PluginProjection>(),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		retention: text().$type<PluginRelationshipRetention>(),
		userWritePolicy: text().$type<PluginRelationshipUserWritePolicy>(),
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
		sort: text(),
		icon: text().notNull(),
		sortOrder: integer().notNull(),
		filter: jsonb().$type<Filter>(),
		dataSources: jsonb().$type<RyotQLDocument>(),
		settings: jsonb().$type<SavedViewSettings>().notNull(),
		renderer: jsonb().$type<SavedViewRenderer>().notNull(),
		arguments: jsonb().$type<Readonly<Record<string, JsonValue>>>().notNull().default({}),
		pluginRevisionId: text().references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("definition_saved_view_revision_slug_unique")
			.on(table.pluginRevisionId, table.slug)
			.nullsNotDistinct(),
		index("definition_saved_view_slug_idx").on(table.slug),
	],
);

export const definitionCalendarSource = snakeCase.table(
	"definition_calendar_source",
	{
		...definitionColumns(),
		art: text(),
		done: text(),
		caption: text(),
		icon: text().notNull(),
		startAt: text().notNull(),
		query: jsonb().$type<RowSourceQuery>().notNull(),
		subject: jsonb().$type<SavedViewSubject>().notNull(),
		precision: text().$type<RowSourcePrecision>().notNull(),
		pluginRevisionId: text()
			.notNull()
			.references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("definition_calendar_source_revision_slug_unique").on(
			table.pluginRevisionId,
			table.slug,
		),
		index("definition_calendar_source_slug_idx").on(table.slug),
	],
);

export const definitionSignalSchedule = snakeCase.table(
	"definition_signal_schedule",
	{
		delayDays: integer(),
		slug: text().notNull(),
		dueAt: text().notNull(),
		signal: text().notNull(),
		occurrence: text().notNull(),
		position: integer().notNull(),
		requiresProKey: boolean().notNull(),
		query: jsonb().$type<RowSourceQuery>().notNull(),
		subject: jsonb().$type<SavedViewSubject>().notNull(),
		precision: text().$type<RowSourcePrecision>().notNull(),
		properties: jsonb().$type<PluginSignalSchedule["properties"]>().notNull(),
		freshness: jsonb().$type<NonNullable<PluginSignalSchedule["freshness"]>>(),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		pluginRevisionId: text()
			.notNull()
			.references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("definition_signal_schedule_revision_slug_unique").on(
			table.pluginRevisionId,
			table.slug,
		),
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
		plan: jsonb().$type<NonNullable<PluginImportSource["plan"]>>(),
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
		plan: jsonb().$type<SourcePlan>(),
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

export const definitionProvider = snakeCase.table(
	"definition_provider",
	{
		slug: text().notNull(),
		position: integer().notNull(),
		rootEntitySchemaSlug: text().notNull(),
		pluginRevisionId: text()
			.notNull()
			.references(() => pluginRevision.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.pluginRevisionId, table.slug] })],
);

export const definitionProviderOperation = snakeCase.table(
	"definition_provider_operation",
	{
		operation: text().notNull(),
		scriptSlug: text().notNull(),
		providerSlug: text().notNull(),
		pluginRevisionId: text().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.pluginRevisionId, table.providerSlug, table.operation] }),
		foreignKey({
			name: "definition_provider_operation_provider_fk",
			columns: [table.pluginRevisionId, table.providerSlug],
			foreignColumns: [definitionProvider.pluginRevisionId, definitionProvider.slug],
		}).onDelete("cascade"),
	],
);
