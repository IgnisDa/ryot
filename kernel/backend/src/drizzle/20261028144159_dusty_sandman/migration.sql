CREATE TABLE "reminder" (
	"message" text,
	"timezone" text,
	"entity_title" text,
	"due_at" timestamp(3) with time zone,
	"replacement_id" text,
	"formatter_run_id" text,
	"trigger_id" text,
	"id" text PRIMARY KEY,
	"removed_at" timestamp(3) with time zone,
	"settled_at" timestamp(3) with time zone,
	"reconcile_at" timestamp(3) with time zone,
	"processing_at" timestamp(3) with time zone,
	"account_generation" text NOT NULL,
	"reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"outcome" text,
	"state" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"dispatch" jsonb,
	"original_schedule" jsonb,
	"entity_id" text,
	"parent_entity_id" text,
	"user_id" text NOT NULL,
	CONSTRAINT "reminder_revision_check" CHECK ("revision" > 0),
	CONSTRAINT "reminder_state_check" CHECK ("state" in ('needs-scheduling', 'scheduled', 'processing', 'settled', 'cancelled')),
	CONSTRAINT "reminder_schedule_check" CHECK ("state" not in ('scheduled', 'processing') or ("due_at" is not null and "timezone" is not null and "entity_id" is not null and "reconcile_at" is not null)),
	CONSTRAINT "reminder_inactive_schedule_check" CHECK ("state" <> 'needs-scheduling' or ("due_at" is null and "timezone" is null and "original_schedule" is not null)),
	CONSTRAINT "reminder_processing_check" CHECK ("state" <> 'processing' or ("processing_at" is not null and "formatter_run_id" is not null and "trigger_id" is not null and "dispatch" is not null and "reconcile_at" is not null)),
	CONSTRAINT "reminder_outcome_check" CHECK (("state" = 'settled' and "outcome" in ('accepted', 'partial', 'failed', 'unknown', 'not-sent') and "outcome" is not null and "settled_at" is not null) or ("state" <> 'settled' and "outcome" is null)),
	CONSTRAINT "reminder_content_check" CHECK (("removed_at" is null and "message" is not null and length(btrim("message")) between 1 and 4000 and "entity_title" is not null) or ("removed_at" is not null and "state" in ('settled', 'cancelled') and "message" is null and "entity_title" is null and "original_schedule" is null))
);
--> statement-breakpoint
CREATE INDEX "reminder_due_idx" ON "reminder" ("state","due_at","id");--> statement-breakpoint
CREATE INDEX "reminder_reconcile_idx" ON "reminder" ("state","reconcile_at","id");--> statement-breakpoint
CREATE INDEX "reminder_owner_idx" ON "reminder" ("user_id","state","created_at","id");--> statement-breakpoint
CREATE INDEX "reminder_entity_idx" ON "reminder" ("entity_id","user_id");--> statement-breakpoint
CREATE INDEX "reminder_parent_idx" ON "reminder" ("parent_entity_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_formatter_idx" ON "reminder" ("formatter_run_id");--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_entity_id_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_parent_entity_id_entity_id_fkey" FOREIGN KEY ("parent_entity_id") REFERENCES "entity"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_delivery" DROP CONSTRAINT "notification_delivery_reason_check", ADD CONSTRAINT "notification_delivery_reason_check" CHECK (("status" in ('queued', 'sending', 'accepted') and "reason" is null) or ("reason" is not null and (("status" = 'failed' and "reason" in ('preparation-failed', 'provider-rejected')) or ("status" = 'unknown' and "reason" = 'delivery-unknown') or ("status" = 'skipped' and "reason" in ('server-disabled', 'channel-disabled', 'channel-deleted', 'source-cancelled')))));