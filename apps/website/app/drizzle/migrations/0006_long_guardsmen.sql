CREATE TYPE "public"."payment_provider" AS ENUM('paddle', 'polar');--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "polar_customer_id" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "payment_provider" "payment_provider" DEFAULT 'paddle' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_polar_customer_id_unique" UNIQUE("polar_customer_id");