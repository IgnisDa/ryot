ALTER TABLE "event" ADD COLUMN "session_entity_id" text;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_session_entity_id_entity_id_fk" FOREIGN KEY ("session_entity_id") REFERENCES "public"."entity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_session_entity_id_idx" ON "event" USING btree ("session_entity_id");--> statement-breakpoint
CREATE INDEX "event_user_entity_schema_idx" ON "event" USING btree ("user_id","entity_id","event_schema_id");