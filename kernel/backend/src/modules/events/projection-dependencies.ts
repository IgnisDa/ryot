import { sql } from "drizzle-orm";

import type { StreamSource } from "./stream-repository";

const selectedReference = sql`case
	when dependency->>'scope' = 'entity' then source.entity_id
	when dependency->>'scope' = 'session' then source.session_entity_id
	else source.properties->>(dependency->'scope'->>'property') end`;

const declarations = sql`
	join plugin p on p.id = source.event_schema_plugin_id
	join definition_entity_schema e on e.plugin_revision_id = p.active_revision_id
	join definition_event_schema d on d.entity_schema_id = e.id
	cross join lateral jsonb_array_elements(d.projection->'inputs') dependency`;

export const projectionDependencyTargets = (sources: ReturnType<typeof sql>) => sql`
	with sources as (${sources}), source_schemas as (
		select distinct event_schema_plugin_id, event_schema_slug from sources
	), projection_declarations as (
		select p.id as plugin_id, e.slug as entity_schema_slug, d.id as declaration_id,
			d.slug as event_schema_slug, input.ordinality as input_index, input.value as dependency
		from plugin p
		join definition_entity_schema e on e.plugin_revision_id = p.active_revision_id
		join definition_event_schema d on d.entity_schema_id = e.id
		cross join lateral jsonb_array_elements(d.projection->'inputs') with ordinality input(value, ordinality)
		where exists (
			select 1 from source_schemas source where source.event_schema_plugin_id = p.id
			and (source.event_schema_slug = input.value->>'eventSchemaSlug'
				or source.event_schema_slug = input.value->'through'->>'eventSchemaSlug')
		)
	), selected_inputs as (
		select source.source_index, source.user_id, source.event_schema_slug,
			declaration.declaration_id, declaration.input_index, declaration.dependency,
			${selectedReference} as entity_reference
		from sources source
		join projection_declarations declaration on declaration.plugin_id = source.event_schema_plugin_id
			and source.event_schema_slug = declaration.dependency->>'eventSchemaSlug'
	), mapping_edges as (
		select declaration.declaration_id, declaration.input_index, mapping.user_id,
			mapping.properties->>(dependency->'through'->>'sourceProperty') as source_reference,
			mapping.properties->>(dependency->'through'->>'targetProperty') as entity_id
		from projection_declarations declaration
		join event mapping on mapping.event_schema_plugin_id = declaration.plugin_id
			and mapping.event_schema_slug = dependency->'through'->>'eventSchemaSlug'
	), dependency_references as (
		select source_index, user_id, event_schema_slug, declaration_id, input_index,
			entity_reference as entity_id
		from selected_inputs where dependency->'through' is null
		union all
		select source.source_index, source.user_id, source.event_schema_slug,
			source.declaration_id, source.input_index, mapping.entity_id
		from selected_inputs source
		join mapping_edges mapping on mapping.declaration_id = source.declaration_id
			and mapping.input_index = source.input_index and mapping.user_id = source.user_id
			and mapping.source_reference = source.entity_reference
		union all
		select source.source_index, source.user_id, source.event_schema_slug,
			declaration.declaration_id, declaration.input_index,
			source.properties->>(dependency->'through'->>'targetProperty')
		from sources source
		join projection_declarations declaration on declaration.plugin_id = source.event_schema_plugin_id
			and source.event_schema_slug = dependency->'through'->>'eventSchemaSlug'
	)
	select distinct reference.source_index as "sourceIndex", reference.user_id as "userId",
		target.id as "entityId", declaration.event_schema_slug as "eventSchemaSlug",
		declaration.plugin_id as "eventSchemaPluginId",
		(dependency->'through' is not null or dependency->>'scope' <> 'entity'
			or reference.event_schema_slug <> declaration.event_schema_slug) as restart
	from dependency_references reference
	join projection_declarations declaration on declaration.declaration_id = reference.declaration_id
		and declaration.input_index = reference.input_index
	join entity target on target.id = reference.entity_id
		and target.entity_schema_slug = declaration.entity_schema_slug
		and target.entity_schema_plugin_id = declaration.plugin_id
		and (target.user_id is null or target.user_id = reference.user_id)`;

export const projectionSourceReferences = (sources: ReturnType<typeof sql>) => sql`
	with sources as (${sources}), scope_references as (
		select source.user_id, source.entity_id from sources source
		union
		select source.user_id, source.session_entity_id from sources source
		union
		select source.user_id, ${selectedReference} from sources source ${declarations}
		where source.event_schema_slug = dependency->>'eventSchemaSlug'
		union
		select source.user_id, source.properties->>(dependency->'through'->>'sourceProperty')
		from sources source ${declarations}
		where source.event_schema_slug = dependency->'through'->>'eventSchemaSlug'
		union
		select source.user_id, source.properties->>(dependency->'through'->>'targetProperty')
		from sources source ${declarations}
		where source.event_schema_slug = dependency->'through'->>'eventSchemaSlug'
	)
	select target.id from entity target where exists (
		select 1 from scope_references reference where reference.entity_id = target.id
		and (target.user_id is null or target.user_id = reference.user_id)
	)
	order by target.id collate "C" for no key update of target`;

export const projectionSources = (sources: ReadonlyArray<StreamSource>) => sql`
	select (ordinality - 1)::integer as source_index, value->>'userId' as user_id,
		value->>'entityId' as entity_id, value->>'sessionEntityId' as session_entity_id,
		value->>'eventSchemaSlug' as event_schema_slug,
		value->>'eventSchemaPluginId' as event_schema_plugin_id, value->'properties' as properties
	from jsonb_array_elements(${JSON.stringify(sources)}::jsonb) with ordinality`;
