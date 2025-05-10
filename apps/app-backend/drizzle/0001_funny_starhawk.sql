ALTER TABLE "saved_view" ADD COLUMN "icon" text NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "accent_color" text NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "facet_id" text;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_facet_id_facet_id_fk" FOREIGN KEY ("facet_id") REFERENCES "public"."facet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_view_facet_id_idx" ON "saved_view" USING btree ("facet_id");