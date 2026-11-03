DROP INDEX "relationship_source_entity_id_idx";--> statement-breakpoint
CREATE INDEX "relationship_source_schema_idx" ON "relationship" ("source_entity_id","relationship_schema_slug");