ALTER TABLE "event_stream" ADD COLUMN "repair_epoch" text DEFAULT 'initial' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_stream_work" ADD COLUMN "input_repair_job_id" text;--> statement-breakpoint
CREATE INDEX "event_stream_work_input_repair_job_idx" ON "event_stream_work" ("input_repair_job_id");