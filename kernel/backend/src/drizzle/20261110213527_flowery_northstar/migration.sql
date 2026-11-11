ALTER TABLE "definition_saved_view" ADD COLUMN "arguments" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "definition_saved_view" ADD COLUMN "filter" jsonb;--> statement-breakpoint
ALTER TABLE "definition_saved_view" ADD COLUMN "sort" text;--> statement-breakpoint
ALTER TABLE "plugin_revision" ADD COLUMN "queries" jsonb;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "arguments" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "filter" jsonb;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "sort" text;