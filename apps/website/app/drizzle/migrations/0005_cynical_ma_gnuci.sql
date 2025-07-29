CREATE TABLE "customer_purchase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_type" "plan_type" NOT NULL,
	"cancelled_on" timestamp with time zone,
	"product_type" "product_type" NOT NULL,
	"created_on" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_purchase" ADD CONSTRAINT "customer_purchase_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "customer_purchase" ("customer_id", "plan_type", "product_type", "cancelled_on", "created_on")
SELECT 
	"id" as "customer_id",
	"plan_type",
	"product_type",
	CASE 
		WHEN "has_cancelled" = true THEN "created_on"
		ELSE NULL
	END as "cancelled_on",
	"created_on"
FROM "customer"
WHERE "plan_type" IS NOT NULL AND "product_type" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer" DROP COLUMN "product_type";--> statement-breakpoint
ALTER TABLE "customer" DROP COLUMN "plan_type";--> statement-breakpoint
ALTER TABLE "customer" DROP COLUMN "renew_on";--> statement-breakpoint
ALTER TABLE "customer" DROP COLUMN "has_cancelled";