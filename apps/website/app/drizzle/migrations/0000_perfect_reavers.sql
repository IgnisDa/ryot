DO $$ BEGIN
 CREATE TYPE "public"."plan_type" AS ENUM('monthly', 'yearly', 'lifetime');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."product_type" AS ENUM('cloud', 'self_hosted');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_on" timestamp with time zone DEFAULT now() NOT NULL,
	"oidc_issuer_id" text,
	"paddle_customer_id" text,
	"paddle_first_transaction_id" text,
	"product_type" "product_type",
	"plan_type" "plan_type",
	"renew_on" date,
	"unkey_key_id" text,
	"ryot_user_id" text,
	CONSTRAINT "customer_email_unique" UNIQUE("email"),
	CONSTRAINT "customer_oidc_issuer_id_unique" UNIQUE("oidc_issuer_id"),
	CONSTRAINT "customer_paddle_customer_id_unique" UNIQUE("paddle_customer_id"),
	CONSTRAINT "customer_paddle_first_transaction_id_unique" UNIQUE("paddle_first_transaction_id")
);
