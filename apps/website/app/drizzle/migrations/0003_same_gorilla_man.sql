ALTER TYPE "public"."plan_type" ADD VALUE 'free' BEFORE 'monthly';--> statement-breakpoint
ALTER TABLE "customer" DROP CONSTRAINT "customer_paddle_first_transaction_id_unique";--> statement-breakpoint
ALTER TABLE "customer" DROP COLUMN IF EXISTS "paddle_first_transaction_id";