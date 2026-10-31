CREATE TABLE "backup_staging_record" (
	"run_id" text,
	"namespace" text,
	"id" text,
	"section" text NOT NULL,
	"value" jsonb NOT NULL,
	"destination_id" text,
	"inserted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "backup_staging_record_pkey" PRIMARY KEY("run_id","namespace","id")
);
--> statement-breakpoint
CREATE TABLE "backup_staging_reference" (
	"run_id" text,
	"source_namespace" text,
	"source_id" text,
	"target_namespace" text,
	"target_id" text,
	CONSTRAINT "backup_staging_reference_pkey" PRIMARY KEY("run_id","source_namespace","source_id","target_namespace","target_id")
);
--> statement-breakpoint
CREATE TABLE "backup_staging_run" (
	"id" text PRIMARY KEY,
	"backup_run_id" text NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "backup_staging_record_run_section_id_idx" ON "backup_staging_record" ("run_id","section","id");--> statement-breakpoint
CREATE INDEX "backup_staging_reference_run_target_idx" ON "backup_staging_reference" ("run_id","target_namespace","target_id");--> statement-breakpoint
ALTER TABLE "backup_staging_record" ADD CONSTRAINT "backup_staging_record_run_id_backup_staging_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "backup_staging_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_staging_reference" ADD CONSTRAINT "backup_staging_reference_run_id_backup_staging_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "backup_staging_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_staging_run" ADD CONSTRAINT "backup_staging_run_backup_run_id_backup_run_id_fkey" FOREIGN KEY ("backup_run_id") REFERENCES "backup_run"("id") ON DELETE CASCADE;