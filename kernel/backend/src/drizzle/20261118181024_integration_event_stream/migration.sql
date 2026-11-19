CREATE TABLE "integration_event_stream" (
	"integration_id" text,
	"entity_id" text,
	"event_schema_slug" text,
	"observed_at" timestamp(3) with time zone NOT NULL,
	"eligible_at" timestamp(3) with time zone,
	"fingerprint" text,
	"pending" jsonb,
	CONSTRAINT "integration_event_stream_pkey" PRIMARY KEY("integration_id","entity_id","event_schema_slug")
);
--> statement-breakpoint
CREATE INDEX "integration_event_stream_entity_idx" ON "integration_event_stream" ("entity_id");--> statement-breakpoint
ALTER TABLE "integration_event_stream" ADD CONSTRAINT "integration_event_stream_integration_id_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_event_stream" ADD CONSTRAINT "integration_event_stream_entity_id_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE;