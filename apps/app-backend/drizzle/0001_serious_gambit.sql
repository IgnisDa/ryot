ALTER TABLE "event_schema" DROP CONSTRAINT "event_schema_entity_schema_slug_unique";--> statement-breakpoint
ALTER TABLE "event_schema" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "event_schema" ADD CONSTRAINT "event_schema_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_schema" ADD CONSTRAINT "event_schema_user_entity_schema_slug_unique" UNIQUE("user_id","entity_schema_id","slug");