DROP VIEW "global_event_schema";--> statement-breakpoint
DROP VIEW "user_event_schema";--> statement-breakpoint
ALTER TABLE "definition_event_schema" ADD COLUMN "event_group" jsonb;--> statement-breakpoint
CREATE VIEW "global_event_schema" AS (
			select v.id, v.entity_schema_id, e.slug as entity_schema_slug, e.plugin_id, e.package_id, e.plugin_revision_id, v.slug, v.name, v.position, v.properties_schema, v.projection, v.event_group
			from "global_entity_schema" e
			join definition_event_schema v on v.entity_schema_id = e.id
		);--> statement-breakpoint
CREATE VIEW "user_event_schema" AS (
			select e.user_id, v.id, v.entity_schema_id, e.slug as entity_schema_slug, e.plugin_id, e.package_id, e.plugin_revision_id, v.slug, v.name, v.position, v.properties_schema, v.projection, e.is_effective, v.event_group
			from "user_entity_schema" e
			join definition_event_schema v on v.entity_schema_id = e.id
		);