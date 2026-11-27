CREATE TABLE "billing_event" (
	"provider" "payment_provider" NOT NULL,
	"id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_on" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_on" timestamp with time zone,
	"notified_on" timestamp with time zone,
	"notice" text,
	CONSTRAINT "billing_event_provider_id_pk" PRIMARY KEY("provider","id")
);
--> statement-breakpoint
ALTER TABLE "billing_event" ADD CONSTRAINT "billing_event_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "billing_event_pending_customer_idx" ON "billing_event" USING btree ("customer_id") WHERE "billing_event"."completed_on" is null;
