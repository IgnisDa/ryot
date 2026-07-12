CREATE TABLE "backup_run" (
	"error" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"artifact_provider" text,
	"artifact_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "managed_asset" (
	"provider" text,
	"key" text,
	"owner_user_id" text NOT NULL,
	"size" integer NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "managed_asset_pkey" PRIMARY KEY("provider","key")
);
--> statement-breakpoint
CREATE INDEX "backup_run_user_id_idx" ON "backup_run" ("user_id");--> statement-breakpoint
CREATE INDEX "backup_run_status_idx" ON "backup_run" ("status");--> statement-breakpoint
CREATE INDEX "backup_run_expires_at_idx" ON "backup_run" ("expires_at");--> statement-breakpoint
CREATE INDEX "managed_asset_owner_user_id_idx" ON "managed_asset" ("owner_user_id");--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managed_asset" ADD CONSTRAINT "managed_asset_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;