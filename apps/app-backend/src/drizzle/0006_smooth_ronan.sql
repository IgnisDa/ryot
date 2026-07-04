ALTER TABLE "subscription_run" ADD COLUMN "rule_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "subscription_run" ADD COLUMN "sandbox_script_id" text NOT NULL;