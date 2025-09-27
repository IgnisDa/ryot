CREATE TABLE "apikey" (
	"name" text,
	"start" text,
	"prefix" text,
	"metadata" text,
	"permissions" text,
	"remaining" integer,
	"key" text NOT NULL,
	"expires_at" timestamp,
	"refill_amount" integer,
	"id" text PRIMARY KEY NOT NULL,
	"last_request" timestamp,
	"refill_interval" integer,
	"last_refill_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"enabled" boolean DEFAULT true,
	"request_count" integer DEFAULT 0,
	"rate_limit_max" integer DEFAULT 10,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "apikey_userId_idx" ON "apikey" USING btree ("user_id");