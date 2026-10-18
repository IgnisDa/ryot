ALTER TABLE "entity" ADD COLUMN "collection_order_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "relationship_collection_order_idx" ON "relationship" ("target_entity_id",(case when "relationship_schema_slug" = 'member-of' and "relationship_schema_plugin_id" is null then ("properties" ->> 'rank')::double precision end),"source_entity_id") WHERE "relationship_schema_slug" = 'member-of' and "relationship_schema_plugin_id" is null;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_collection_rank_valid" CHECK ("relationship_schema_slug" <> 'member-of' or "relationship_schema_plugin_id" is not null or coalesce(("user_id" is not null and jsonb_typeof("properties" -> 'rank') = 'number' and ("properties" ->> 'rank')::numeric = trunc(("properties" ->> 'rank')::numeric) and abs(("properties" ->> 'rank')::numeric) < 4503599627370496), false));--> statement-breakpoint
CREATE FUNCTION collection_order_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.relationship_schema_slug = 'member-of' AND OLD.relationship_schema_plugin_id IS NULL THEN
      UPDATE entity SET collection_order_revision = collection_order_revision + 1 WHERE id = OLD.target_entity_id;
    END IF;
  ELSIF NEW.relationship_schema_slug = 'member-of' AND NEW.relationship_schema_plugin_id IS NULL THEN
    IF TG_OP = 'INSERT' OR OLD.properties -> 'rank' IS DISTINCT FROM NEW.properties -> 'rank' THEN
      UPDATE entity SET collection_order_revision = collection_order_revision + 1 WHERE id = NEW.target_entity_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER collection_order_changed AFTER INSERT OR DELETE OR UPDATE OF properties ON relationship FOR EACH ROW EXECUTE FUNCTION collection_order_changed();
