ALTER TABLE "user" ADD COLUMN "retiring_account_generation" text;--> statement-breakpoint
ALTER TABLE "workflow_execution" ADD COLUMN "account_token" text;--> statement-breakpoint
ALTER TABLE "workflow_execution" ADD COLUMN "account_user_id" text;--> statement-breakpoint
UPDATE "user" u SET "retiring_account_generation" = o."metadata"->'user'->>'accountGeneration'
FROM "user_lifecycle_operation" o
WHERE o."user_id" = u."id" AND o."status" IN ('pending', 'running', 'failed');--> statement-breakpoint
UPDATE "workflow_execution" e SET "account_user_id" = r."owner_user_id", "account_token" = r."account_generation"->>'token'
FROM "mutation_receipt" r
WHERE r."receipt_type" = 'workflow-owner' AND r."workflow_name" = e."workflow_name"
	AND r."execution_id" = e."execution_id";--> statement-breakpoint
DELETE FROM "mutation_receipt" WHERE "receipt_type" = 'workflow-owner';--> statement-breakpoint
ALTER TABLE "mutation_receipt" DROP CONSTRAINT "mutation_receipt_workflow_owner_check";--> statement-breakpoint
ALTER TABLE "mutation_receipt" DROP COLUMN "workflow_name";--> statement-breakpoint
CREATE INDEX "workflow_execution_account_idx" ON "workflow_execution" ("account_user_id") WHERE "status" = 'active';--> statement-breakpoint
ALTER TABLE "workflow_execution" ADD CONSTRAINT "workflow_execution_account_check" CHECK (("account_user_id" is null) = ("account_token" is null));--> statement-breakpoint
ALTER TABLE "mutation_receipt" DROP CONSTRAINT "mutation_receipt_type_check", ADD CONSTRAINT "mutation_receipt_type_check" CHECK ("receipt_type" in ('item', 'batch-decision', 'batch-candidate'));
