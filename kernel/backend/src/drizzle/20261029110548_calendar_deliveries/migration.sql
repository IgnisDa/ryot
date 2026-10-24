CREATE TABLE "calendar_delivery" (
	"source_slug" text,
	"occurrence_key" text,
	"trigger_id" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"plugin_id" text,
	"user_id" text,
	CONSTRAINT "calendar_delivery_pkey" PRIMARY KEY("user_id","plugin_id","source_slug","occurrence_key")
);
--> statement-breakpoint
DROP VIEW "global_calendar_source";--> statement-breakpoint
DROP VIEW "user_calendar_source_effective";--> statement-breakpoint
ALTER TABLE "definition_calendar_source" ADD COLUMN "delivery" jsonb;--> statement-breakpoint
CREATE INDEX "calendar_delivery_created_at_idx" ON "calendar_delivery" ("created_at");--> statement-breakpoint
ALTER TABLE "calendar_delivery" ADD CONSTRAINT "calendar_delivery_plugin_id_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugin"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "calendar_delivery" ADD CONSTRAINT "calendar_delivery_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE VIEW "global_calendar_source" AS (
			select d.id, r.plugin_id, g.package_id, d.plugin_revision_id, d.slug, d.name, d.position, d.icon, d.query, d.subject, d.start_at, d.precision, d.caption, d.art, d.done, d.delivery
			from definition_calendar_source d
			join plugin_revision r on r.id = d.plugin_revision_id
			join (
 select p.id as plugin_id, p.package_id, p.active_revision_id, p.environment_config_revision_id as config_revision_id, coalesce(c.owner_user_id is null and c.encrypted_payload is not null, false) as is_executable
	from plugin p
	left join plugin_config_revision c on c.id = p.environment_config_revision_id
	where p.owner_user_id is null and p.status = 'active'
) g on g.plugin_id = r.plugin_id and g.active_revision_id = d.plugin_revision_id
		);--> statement-breakpoint
CREATE VIEW "user_calendar_source_effective" AS (
			select p.user_id, d.id, p.plugin_id, p.package_id, d.plugin_revision_id, p.scope as plugin_scope, d.slug, d.name, d.position, d.icon, d.query, d.subject, d.start_at, d.precision, d.caption, d.art, d.done, d.delivery, p.is_definition_effective as is_effective, coalesce(o.is_hidden, false) as is_hidden
			from "user_plugin" p
			join definition_calendar_source d on d.plugin_revision_id = p.active_revision_id
			left join "calendar_source_override" o on o.user_id = p.user_id and o.plugin_id = p.plugin_id and o.slug = d.slug
			where p.is_listed
		);