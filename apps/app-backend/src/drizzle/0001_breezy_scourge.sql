WITH ranked_relationships AS (
	SELECT
		ctid,
		ROW_NUMBER() OVER (
			PARTITION BY "user_id", "source_entity_id", "target_entity_id", "rel_type"
			ORDER BY "created_at" DESC, "id" DESC
		) AS row_number
	FROM "relationship"
)
DELETE FROM "relationship"
WHERE ctid IN (
	SELECT ctid
	FROM ranked_relationships
	WHERE row_number > 1
);
--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_user_source_target_rel_type_unique" UNIQUE("user_id","source_entity_id","target_entity_id","rel_type");
