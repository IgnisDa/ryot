ALTER TABLE "saved_view" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_user_slug_unique" UNIQUE("user_id","slug");