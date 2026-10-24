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
	), source_selectors as (
		select distinct plugin_id, dependency from projection_declarations
	), selected_inputs as (
		select distinct source.source_index, source.user_id, source.event_schema_slug,
			source.event_schema_plugin_id as plugin_id, declaration.dependency,
			${selectedReference} as entity_reference
		from sources source
		join source_selectors declaration on declaration.plugin_id = source.event_schema_plugin_id
			and source.event_schema_slug = declaration.dependency->>'eventSchemaSlug'
	), direct_references as materialized (
		select source.source_index, source.user_id, source.event_schema_slug, source.plugin_id,
			source.dependency, target.id as entity_id, target.entity_schema_slug
		from selected_inputs source
		join entity target on target.id = source.entity_reference
			and target.entity_schema_plugin_id = source.plugin_id
			and (target.user_id is null or target.user_id = source.user_id)
		where source.dependency->'through' is null
	), mapping_schemas as (
		select distinct plugin_id, dependency->'through'->>'eventSchemaSlug' as event_schema_slug
		from projection_declarations where dependency->'through'->>'eventSchemaSlug' is not null
	), mapping_events as materialized (
		select mapping.user_id, mapping.event_schema_plugin_id, mapping.event_schema_slug, mapping.properties
		from event mapping
		join mapping_schemas schema on schema.plugin_id = mapping.event_schema_plugin_id
			and schema.event_schema_slug = mapping.event_schema_slug
	), mapping_edges as (
		select distinct declaration.declaration_id, declaration.input_index, mapping.user_id,
			mapping.properties->>(declaration.dependency->'through'->>'sourceProperty') as source_reference,
			mapping.properties->>(declaration.dependency->'through'->>'targetProperty') as entity_id
		from projection_declarations declaration
		join mapping_events mapping on mapping.event_schema_plugin_id = declaration.plugin_id
			and mapping.event_schema_slug = declaration.dependency->'through'->>'eventSchemaSlug'
	)
	select distinct "sourceIndex", "userId", "entityId", "eventSchemaSlug", "eventSchemaPluginId", restart
	from (
		select source.source_index as "sourceIndex", source.user_id as "userId",
			source.entity_id as "entityId", declaration.event_schema_slug as "eventSchemaSlug",
			declaration.plugin_id as "eventSchemaPluginId",
			(declaration.dependency->'through' is not null or declaration.dependency->>'scope' <> 'entity'
				or source.event_schema_slug <> declaration.event_schema_slug) as restart
		from direct_references source
		join projection_declarations declaration on declaration.plugin_id = source.plugin_id
			and declaration.dependency = source.dependency
			and declaration.entity_schema_slug = source.entity_schema_slug
		union all
		select source.source_index, source.user_id, target.id, declaration.event_schema_slug,
			declaration.plugin_id,
			(declaration.dependency->'through' is not null or declaration.dependency->>'scope' <> 'entity'
				or source.event_schema_slug <> declaration.event_schema_slug)
		from selected_inputs source
		join projection_declarations declaration on declaration.plugin_id = source.plugin_id
			and declaration.dependency = source.dependency
		join mapping_edges mapping on mapping.declaration_id = declaration.declaration_id
			and mapping.input_index = declaration.input_index and mapping.user_id = source.user_id
			and mapping.source_reference = source.entity_reference
		join entity target on target.id = mapping.entity_id
			and target.entity_schema_slug = declaration.entity_schema_slug
			and target.entity_schema_plugin_id = declaration.plugin_id
			and (target.user_id is null or target.user_id = source.user_id)
		union all
		select source.source_index, source.user_id, target.id, declaration.event_schema_slug,
			declaration.plugin_id,
			(declaration.dependency->'through' is not null or declaration.dependency->>'scope' <> 'entity'
				or source.event_schema_slug <> declaration.event_schema_slug)
		from sources source
		join projection_declarations declaration on declaration.plugin_id = source.event_schema_plugin_id
			and source.event_schema_slug = declaration.dependency->'through'->>'eventSchemaSlug'
		join entity target on target.id = source.properties->>(declaration.dependency->'through'->>'targetProperty')
		and target.entity_schema_slug = declaration.entity_schema_slug
		and target.entity_schema_plugin_id = declaration.plugin_id
		and (target.user_id is null or target.user_id = source.user_id)
	) targets`;

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
