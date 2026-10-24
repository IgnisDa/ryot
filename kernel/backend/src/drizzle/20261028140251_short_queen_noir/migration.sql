CREATE TABLE "notification" (
	"source_run_id" text,
	"id" text PRIMARY KEY,
	"settled_at" timestamp(3) with time zone,
	"recover_at" timestamp(3) with time zone NOT NULL,
	"source_key" text NOT NULL,
	"input_digest" text NOT NULL,
	"account_generation" text NOT NULL,
	"outcome" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"state" text NOT NULL,
	"request" jsonb NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "notification_state_check" CHECK (("state" = 'admitted' and "outcome" is null and "settled_at" is null) or ("state" = 'settled' and "outcome" is not null and "outcome" in ('accepted', 'partial', 'failed', 'unknown', 'not-sent') and "settled_at" is not null)),
	CONSTRAINT "notification_reason_check" CHECK ("reason" is null or ("state" = 'settled' and "outcome" = 'not-sent' and "reason" = 'no-enabled-channels')),
	CONSTRAINT "notification_request_check" CHECK (jsonb_typeof("request") = 'object' and ("request" = '{"kind":"test"}'::jsonb or ("request" @> '{"kind":"message"}'::jsonb and "request" ? 'message' and jsonb_typeof("request"->'message') = 'string')))
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"attempt_id" text,
	"diagnostic" text,
	"id" text PRIMARY KEY,
	"claimed_at" timestamp(3) with time zone,
	"settled_at" timestamp(3) with time zone,
	"channel_id" text NOT NULL,
	"description" text NOT NULL,
	"reason" text,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"notification_id" text NOT NULL,
	CONSTRAINT "notification_delivery_status_check" CHECK ("status" in ('queued', 'sending', 'accepted', 'failed', 'unknown', 'skipped')),
	CONSTRAINT "notification_delivery_attempt_check" CHECK (("attempt_id" is null and "claimed_at" is null and "status" not in ('sending', 'accepted', 'unknown')) or ("attempt_id" is not null and "claimed_at" is not null and "status" <> 'queued')),
	CONSTRAINT "notification_delivery_settlement_check" CHECK (("status" in ('queued', 'sending') and "settled_at" is null) or ("status" not in ('queued', 'sending') and "settled_at" is not null)),
	CONSTRAINT "notification_delivery_reason_check" CHECK (("status" in ('queued', 'sending', 'accepted') and "reason" is null) or ("reason" is not null and (("status" = 'failed' and "reason" in ('preparation-failed', 'provider-rejected')) or ("status" = 'unknown' and "reason" = 'delivery-unknown') or ("status" = 'skipped' and "reason" in ('server-disabled', 'channel-disabled', 'channel-deleted')))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_source_idx" ON "notification" ("user_id","account_generation","source_key");--> statement-breakpoint
CREATE INDEX "notification_recovery_idx" ON "notification" ("state","recover_at","id");--> statement-breakpoint
CREATE INDEX "notification_owner_idx" ON "notification" ("user_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "notification_source_run_idx" ON "notification" ("source_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_channel_idx" ON "notification_delivery" ("notification_id","channel_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_claim_idx" ON "notification_delivery" ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_retention_idx" ON "notification_delivery" ("settled_at");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE CASCADE;