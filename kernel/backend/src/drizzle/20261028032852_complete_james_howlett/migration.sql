ALTER TABLE "definition_relationship_schema" ADD COLUMN "retention" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "check_after" timestamp(3) with time zone DEFAULT now() + interval '7 days' NOT NULL;--> statement-breakpoint
CREATE INDEX "entity_check_after_idx" ON "entity" ("check_after") WHERE "provider_id" is not null;--> statement-breakpoint
CREATE INDEX "event_stream_work_current_job_idx" ON "event_stream_work" ("current_job_id");--> statement-breakpoint
CREATE INDEX "mutation_receipt_recorded_at_idx" ON "mutation_receipt" ("recorded_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_execution_id_idx" ON "workflow_execution" ("execution_id");