ALTER TABLE "definition_entity_schema" ADD COLUMN "occurs_at_properties" text[];--> statement-breakpoint
UPDATE "definition_entity_schema" SET "occurs_at_properties" = ARRAY["occurs_at_property"] WHERE "occurs_at_property" IS NOT NULL;--> statement-breakpoint
DROP FUNCTION IF EXISTS ryot_entity_occurs_at(text, jsonb);