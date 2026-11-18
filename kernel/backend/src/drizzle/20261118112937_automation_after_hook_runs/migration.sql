DELETE FROM "automation_trigger" WHERE "category" = 'request';--> statement-breakpoint
DELETE FROM "automation_run" WHERE "stage" = 'before' OR "status" = 'rejected';--> statement-breakpoint
UPDATE "automation_trigger" SET "blocked_reason" = jsonb_build_object('code', "blocked_reason"->'code', 'omittedHooks', "blocked_reason"->'omittedHooks') WHERE "blocked_reason" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_run" DROP CONSTRAINT "automation_run_stage_check";--> statement-breakpoint
ALTER TABLE "automation_run" DROP COLUMN "stage";--> statement-breakpoint
ALTER TABLE "automation_run" DROP COLUMN "delivery";--> statement-breakpoint
ALTER TABLE "automation_run" ALTER COLUMN "retry_policy" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_run" DROP CONSTRAINT "automation_run_status_check", ADD CONSTRAINT "automation_run_status_check" CHECK ("status" in ('queued', 'running', 'succeeded', 'failed', 'skipped') and "attempt_count" >= 0);