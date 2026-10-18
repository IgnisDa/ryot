ALTER TABLE "managed_asset" ADD COLUMN "check_after" timestamp(3) with time zone DEFAULT now() + interval '24 hours' NOT NULL;--> statement-breakpoint
CREATE INDEX "managed_asset_check_after_idx" ON "managed_asset" ("check_after") WHERE "retired_at" is null;--> statement-breakpoint
CREATE INDEX "managed_asset_retired_at_idx" ON "managed_asset" ("retired_at") WHERE "retired_at" is not null;