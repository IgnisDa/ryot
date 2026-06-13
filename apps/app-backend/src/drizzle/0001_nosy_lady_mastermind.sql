CREATE TABLE "notification_platform" (
	"platform" text NOT NULL,
	"platform_specifics" jsonb NOT NULL,
	"configured_events" text[] NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_platform" ADD CONSTRAINT "notification_platform_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_platform_user_id_created_at_idx" ON "notification_platform" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_platform_user_id_is_disabled_idx" ON "notification_platform" USING btree ("user_id","is_disabled");