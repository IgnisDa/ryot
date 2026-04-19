CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text,
	"id_token" text,
	"password" text,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audible_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asin" text,
	"query" text NOT NULL,
	"title" text,
	"author" text,
	"status" text NOT NULL,
	"details" jsonb,
	"image_url" text,
	"source_url" text,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audible_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"query" text,
	"status" text NOT NULL,
	"upload_id" uuid,
	"execution_id" text,
	"confirmation_token" text,
	"final_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audible_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"query" text NOT NULL,
	"interval_seconds" integer DEFAULT 3600 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"user_id" text NOT NULL,
	"script_slug" text NOT NULL,
	"logs" text,
	"status" text NOT NULL,
	"context" jsonb,
	"driver_name" text NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"size" integer NOT NULL,
	"user_id" text NOT NULL,
	"contents" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"identifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audible_item" ADD CONSTRAINT "audible_item_run_id_audible_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audible_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_run_id_audible_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audible_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reference_account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reference_audible_item_run_id_idx" ON "audible_item" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_audible_item_run_query_idx" ON "audible_item" USING btree ("run_id","query");--> statement-breakpoint
CREATE INDEX "reference_audible_run_user_id_idx" ON "audible_run" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reference_sandbox_run_user_id_idx" ON "sandbox_run" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reference_session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reference_upload_user_id_idx" ON "upload" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reference_verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "reference_workflow_step_run_id_idx" ON "workflow_step" USING btree ("run_id");