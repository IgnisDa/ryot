ALTER TABLE "entity" ADD COLUMN "occurs_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "definition_entity_schema" ADD COLUMN "occurs_at_property" text;--> statement-breakpoint
CREATE INDEX "entity_schema_occurs_at_idx" ON "entity" ("entity_schema_slug","occurs_at");