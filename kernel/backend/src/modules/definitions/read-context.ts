import { PluginId, PluginRevisionId } from "@ryot-app/contract/schema/brands";
import { and, eq, getTableColumns, type SQL, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { Data, Schema } from "effect";

import {
	definitionEntitySchema,
	definitionEventSchema,
	definitionRelationshipSchema,
	definitionSignalSchema,
	plugin,
	pluginRevision,
} from "#schema/tables/combined";

export const DefinitionReadContext = Schema.Struct({
	pluginId: PluginId,
	pluginRevisionId: PluginRevisionId,
});

export type DefinitionReadContext = typeof DefinitionReadContext.Type;

const ownerFields = {
	pluginId: sql<(typeof plugin.$inferSelect)["id"]>`${plugin.id}`.as("plugin_id"),
	packageId: sql<(typeof plugin.$inferSelect)["packageId"]>`${plugin.packageId}`.as("package_id"),
	ownerUserId: sql<(typeof plugin.$inferSelect)["ownerId"]>`${plugin.ownerId}`.as("owner_user_id"),
};

const pinnedRevisionWhere = (context: DefinitionReadContext) =>
	and(
		eq(pluginRevision.pluginId, context.pluginId),
		eq(pluginRevision.id, context.pluginRevisionId),
	);

export const pinnedEntitySchemaRows = (context: DefinitionReadContext) =>
	new QueryBuilder()
		.select({ ...getTableColumns(definitionEntitySchema), ...ownerFields })
		.from(definitionEntitySchema)
		.innerJoin(pluginRevision, eq(pluginRevision.id, definitionEntitySchema.pluginRevisionId))
		.innerJoin(plugin, eq(plugin.id, pluginRevision.pluginId))
		.where(pinnedRevisionWhere(context));

export const pinnedEventSchemaRows = (context: DefinitionReadContext) =>
	new QueryBuilder()
		.select({
			...getTableColumns(definitionEventSchema),
			...ownerFields,
			pluginRevisionId: sql<(typeof pluginRevision.$inferSelect)["id"]>`${pluginRevision.id}`.as(
				"plugin_revision_id",
			),
			entitySchemaSlug: sql<(typeof definitionEntitySchema.$inferSelect)["slug"]>`
				${definitionEntitySchema.slug}`.as("entity_schema_slug"),
		})
		.from(definitionEventSchema)
		.innerJoin(
			definitionEntitySchema,
			eq(definitionEntitySchema.id, definitionEventSchema.entitySchemaId),
		)
		.innerJoin(pluginRevision, eq(pluginRevision.id, definitionEntitySchema.pluginRevisionId))
		.innerJoin(plugin, eq(plugin.id, pluginRevision.pluginId))
		.where(pinnedRevisionWhere(context));

export const pinnedRelationshipSchemaRows = (context: DefinitionReadContext) =>
	new QueryBuilder()
		.select({ ...getTableColumns(definitionRelationshipSchema), ...ownerFields })
		.from(definitionRelationshipSchema)
		.innerJoin(pluginRevision, eq(pluginRevision.id, definitionRelationshipSchema.pluginRevisionId))
		.innerJoin(plugin, eq(plugin.id, pluginRevision.pluginId))
		.where(pinnedRevisionWhere(context));

export const pinnedSignalSchemaRows = (context: DefinitionReadContext) =>
	new QueryBuilder()
		.select({ ...getTableColumns(definitionSignalSchema), ...ownerFields })
		.from(definitionSignalSchema)
		.innerJoin(pluginRevision, eq(pluginRevision.id, definitionSignalSchema.pluginRevisionId))
		.innerJoin(plugin, eq(plugin.id, pluginRevision.pluginId))
		.where(pinnedRevisionWhere(context));

export type DefinitionReadKind = "event" | "entity" | "signal" | "relationship";

export class DefinitionReadUnavailable extends Data.TaggedError("DefinitionReadUnavailable")<{
	readonly context: DefinitionReadContext;
}> {}

export const pinnedDefinitionSource = (
	kind: DefinitionReadKind,
	context: DefinitionReadContext,
	userId: null | string,
) => {
	let source: SQL;
	switch (kind) {
		case "event":
			source = pinnedEventSchemaRows(context).getSQL();
			break;
		case "entity":
			source = pinnedEntitySchemaRows(context).getSQL();
			break;
		case "signal":
			source = pinnedSignalSchemaRows(context).getSQL();
			break;
		case "relationship":
			source = pinnedRelationshipSchemaRows(context).getSQL();
			break;
		default:
			throw new Error(String(kind satisfies never));
	}
	return sql`
		SELECT definition_read.*, ${userId}::text AS user_id, true AS is_effective,
			CASE WHEN definition_read.owner_user_id IS NULL THEN 'system' ELSE 'user' END AS plugin_scope
		FROM (${source}) definition_read
	`;
};
