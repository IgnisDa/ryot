import { PluginId, PluginRevisionId } from "@ryot-app/contract/schema/brands";
import { sql, type SQL } from "drizzle-orm";
import { Data, Schema } from "effect";

export const DefinitionReadContext = Schema.Struct({
	pluginId: PluginId,
	pluginRevisionId: PluginRevisionId,
});

export type DefinitionReadContext = typeof DefinitionReadContext.Type;

export class DefinitionReadUnavailable extends Data.TaggedError("DefinitionReadUnavailable")<{
	readonly context: DefinitionReadContext;
}> {}

export type DefinitionReadKind = "entity" | "event" | "relationship" | "signal";

export const pinnedDefinitionSource = (
	kind: DefinitionReadKind,
	context: DefinitionReadContext,
	userId: string | null,
) => {
	let columns: SQL;
	switch (kind) {
		case "entity":
			columns = sql`d.icon, d.user_state, d.merge_identity_properties`;
			break;
		case "event":
			columns = sql`d.entity_schema_id, parent.slug as entity_schema_slug`;
			break;
		case "relationship":
			columns = sql`d.source_entity_schema_slug, d.target_entity_schema_slug`;
			break;
		case "signal":
			columns = sql`d.notification_hook_slug, d.audience_policy, d.catalog_state`;
			break;
		default:
			throw new Error(String(kind satisfies never));
	}
	const from =
		kind === "event"
			? sql`definition_event_schema d join definition_entity_schema parent on parent.id = d.entity_schema_id join plugin_revision r on r.id = parent.plugin_revision_id`
			: sql`${sql.identifier(`definition_${kind}_schema`)} d join plugin_revision r on r.id = d.plugin_revision_id`;
	return sql`SELECT d.id, d.slug, d.name, d.position, d.properties_schema, p.id as plugin_id, p.package_id, r.id as plugin_revision_id, ${userId}::text as user_id, true as is_effective, case when p.owner_user_id is null then 'system' else 'user' end as plugin_scope, ${columns}
		FROM ${from} join plugin p on p.id = r.plugin_id
		WHERE r.id = ${context.pluginRevisionId} AND r.plugin_id = ${context.pluginId}`;
};
