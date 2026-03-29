ALTER TABLE "tracker" ADD COLUMN "is_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tracker" DROP COLUMN "enabled";