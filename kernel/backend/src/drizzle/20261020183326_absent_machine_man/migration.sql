ALTER TABLE "definition_relationship_schema" ADD COLUMN "user_write_policy" text;--> statement-breakpoint
CREATE OR REPLACE VIEW "global_relationship_schema" AS (
			select d.id, r.plugin_id, g.package_id, d.plugin_revision_id, d.slug, d.name, d.position, d.source_entity_schema_slug, d.target_entity_schema_slug, d.properties_schema, d.user_write_policy
			from definition_relationship_schema d
			left join plugin_revision r on r.id = d.plugin_revision_id
			left join "global_plugin" g on g.plugin_id = r.plugin_id and g.active_revision_id = d.plugin_revision_id
			where d.plugin_revision_id is null or g.plugin_id is not null
		);--> statement-breakpoint
CREATE OR REPLACE VIEW "user_relationship_schema" AS (
			select u.id as user_id, d.id, null::text as plugin_id, null::text as package_id, d.plugin_revision_id, null::text as plugin_scope, d.slug, d.name, d.position, d.source_entity_schema_slug, d.target_entity_schema_slug, d.properties_schema, true as is_effective, d.user_write_policy
			from definition_relationship_schema d
			cross join "user" u
			where d.plugin_revision_id is null
			union all
			select p.user_id, d.id, p.plugin_id, p.package_id, d.plugin_revision_id, p.scope, d.slug, d.name, d.position, d.source_entity_schema_slug, d.target_entity_schema_slug, d.properties_schema, p.is_definition_effective and (d.source_entity_schema_slug is null or exists (select 1 from definition_entity_schema e where e.plugin_revision_id = p.active_revision_id and e.slug = d.source_entity_schema_slug)) and (d.target_entity_schema_slug is null or exists (select 1 from definition_entity_schema e where e.plugin_revision_id = p.active_revision_id and e.slug = d.target_entity_schema_slug)), d.user_write_policy
			from "user_plugin" p
			join definition_relationship_schema d on d.plugin_revision_id = p.active_revision_id
			where p.is_listed and (d.source_entity_schema_slug is null or exists (select 1 from definition_entity_schema e where e.plugin_revision_id = p.active_revision_id and e.slug = d.source_entity_schema_slug)) and (d.target_entity_schema_slug is null or exists (select 1 from definition_entity_schema e where e.plugin_revision_id = p.active_revision_id and e.slug = d.target_entity_schema_slug))
		);
