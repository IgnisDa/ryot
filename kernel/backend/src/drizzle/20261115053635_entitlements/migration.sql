ALTER TABLE "definition_integration_provider" ADD COLUMN "entitlement" text;--> statement-breakpoint
ALTER TABLE "definition_signal_schedule" ADD COLUMN "entitlement" text;--> statement-breakpoint
UPDATE "definition_integration_provider" SET "entitlement" = 'pro' WHERE "requires_pro_key";--> statement-breakpoint
UPDATE "definition_signal_schedule" SET "entitlement" = 'pro' WHERE "requires_pro_key";--> statement-breakpoint
ALTER TABLE "definition_integration_provider" DROP COLUMN "requires_pro_key";--> statement-breakpoint
ALTER TABLE "definition_signal_schedule" DROP COLUMN "requires_pro_key";