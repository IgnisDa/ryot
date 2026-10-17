DROP VIEW "global_event_schema";--> statement-breakpoint
DROP VIEW "user_event_schema";--> statement-breakpoint
DROP VIEW "global_entity_schema";--> statement-breakpoint
DROP VIEW "user_entity_schema";--> statement-breakpoint
ALTER TABLE "definition_entity_schema" ADD COLUMN "editor" jsonb;--> statement-breakpoint
CREATE VIEW "global_entity_schema" AS (
			select d.id, r.plugin_id, g.package_id, d.plugin_revision_id, d.slug, d.name, d.position, d.icon, d.properties_schema, d.user_state, d.editor, d.merge_identity_properties
			from definition_entity_schema d
			left join plugin_revision r on r.id = d.plugin_revision_id
			left join (
 select p.id as plugin_id, p.package_id, p.active_revision_id, p.environment_config_revision_id as config_revision_id, coalesce(c.owner_user_id is null and c.encrypted_payload is not null, false) as is_executable
	from plugin p
	left join plugin_config_revision c on c.id = p.environment_config_revision_id
	where p.owner_user_id is null and p.status = 'active'
) g on g.plugin_id = r.plugin_id and g.active_revision_id = d.plugin_revision_id
			where d.plugin_revision_id is null or g.plugin_id is not null
		);--> statement-breakpoint
CREATE VIEW "user_entity_schema" AS (
			select u.id as user_id, d.id, null::text as plugin_id, null::text as package_id, d.plugin_revision_id, null::text as plugin_scope, d.slug, d.name, d.position, d.icon, d.properties_schema, d.user_state, d.editor, d.merge_identity_properties, true as is_effective
			from definition_entity_schema d
			cross join "user" u
			where d.plugin_revision_id is null
			union all
			select p.user_id, d.id, p.plugin_id, p.package_id, d.plugin_revision_id, p.scope, d.slug, d.name, d.position, d.icon, d.properties_schema, d.user_state, d.editor, d.merge_identity_properties, p.is_definition_effective
			from "user_plugin_state" p
			join definition_entity_schema d on d.plugin_revision_id = p.active_revision_id
			where p.is_present and p.is_listed
		);--> statement-breakpoint
CREATE VIEW "global_event_schema" AS (
			select v.id, v.entity_schema_id, e.slug as entity_schema_slug, e.plugin_id, e.package_id, e.plugin_revision_id, v.slug, v.name, v.position, v.properties_schema
			from "global_entity_schema" e
			join definition_event_schema v on v.entity_schema_id = e.id
		);--> statement-breakpoint
CREATE VIEW "user_event_schema" AS (
			select e.user_id, v.id, v.entity_schema_id, e.slug as entity_schema_slug, e.plugin_id, e.package_id, e.plugin_revision_id, v.slug, v.name, v.position, v.properties_schema, e.is_effective
			from "user_entity_schema" e
			join definition_event_schema v on v.entity_schema_id = e.id
		);
