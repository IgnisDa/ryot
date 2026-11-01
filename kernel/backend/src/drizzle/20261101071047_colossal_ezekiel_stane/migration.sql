CREATE TABLE "workflow_runner" (
	"id" text PRIMARY KEY,
	"lease_until" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_step" (
	"exit" json,
	"fire_at" timestamp(3) with time zone,
	"name" text,
	"attempt" integer,
	"execution_id" text,
	"workflow_name" text,
	"kind" text,
	CONSTRAINT "workflow_step_pkey" PRIMARY KEY("workflow_name","execution_id","kind","name","attempt"),
	CONSTRAINT "workflow_step_kind_check" CHECK ("kind" in ('activity', 'clock', 'deferred')),
	CONSTRAINT "workflow_step_clock_check" CHECK (("kind" = 'clock') = ("fire_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "workflow_execution" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "workflow_execution" ADD COLUMN "result" json;--> statement-breakpoint
ALTER TABLE "workflow_execution" ADD COLUMN "payload" json;--> statement-breakpoint
ALTER TABLE "workflow_execution" ADD COLUMN "parent_execution_id" text;--> statement-breakpoint
ALTER TABLE "workflow_execution" ADD COLUMN "parent_workflow_name" text;--> statement-breakpoint
ALTER TABLE "workflow_execution" ADD COLUMN "suspension" text;--> statement-breakpoint
ALTER TABLE "workflow_execution" DROP COLUMN "shard_id";--> statement-breakpoint
CREATE INDEX "workflow_execution_owner_idx" ON "workflow_execution" ("owner") WHERE "status" = 'active';--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_9KAI5HOPHafJ_fkey" FOREIGN KEY ("workflow_name","execution_id") REFERENCES "workflow_execution"("workflow_name","execution_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workflow_execution" ADD CONSTRAINT "workflow_execution_suspension_check" CHECK ("suspension" is null or "suspension" in ('failed', 'waiting'));--> statement-breakpoint
DROP TABLE IF EXISTS "cluster_replies", "cluster_messages", "cluster_locks", "cluster_runners", "cluster_migrations", "cluster_runner_migrations";--> statement-breakpoint
DROP FUNCTION IF EXISTS ryot_fence_workflow_message() CASCADE;--> statement-breakpoint
UPDATE "workflow_execution" SET "status" = 'failed', "completed_at" = now() WHERE "status" = 'active';