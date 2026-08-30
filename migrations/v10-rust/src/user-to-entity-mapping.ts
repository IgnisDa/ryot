import type { QualifiedSchema } from "./migration-resolution";
import {
	buildRequireLegacyTableSql,
	buildReportSql,
	quoteNullableSqlString,
	quoteSqlString,
} from "./shared";

export const buildUserToEntityInLibraryMigrationSql = (input: {
	inLibraryRelationshipSchema: QualifiedSchema;
	libraryEntitySchema: QualifiedSchema;
	libraryEligibleEntitySchemaSlugs: ReadonlyArray<string>;
}) => `
DO $$
DECLARE
	batch_size          constant int := 10000;
	batch_rows_inserted int;
	cursor_id           text         := '';
	next_cursor_id      text;
	rows_inserted       int          := 0;
	started_at          timestamptz  := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("user_to_entity -> in-library relationship", "user_to_entity")}

	LOOP
		WITH batch AS (
			SELECT ute.id::text AS id
			FROM "user_to_entity" ute
			WHERE ute.id::text > cursor_id
			ORDER BY ute.id::text
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		INSERT INTO "relationship" (
			"id",
			"user_id",
			"source_entity_id",
			"target_entity_id",
			"relationship_schema_slug",
			"relationship_schema_plugin_id",
			"properties",
			"created_at"
		)
		SELECT
			md5(ute.entity_id || ':in-library:' || ute.user_id),
			ute.user_id,
			ute.entity_id,
			lib.id,
			${quoteSqlString(input.inLibraryRelationshipSchema.slug)},
			${quoteNullableSqlString(input.inLibraryRelationshipSchema.pluginId)},
			'{}'::jsonb,
			ute.created_on
		FROM "user_to_entity" ute
		INNER JOIN "entity" src ON src.id = ute.entity_id
			AND src.entity_schema_slug IN (${input.libraryEligibleEntitySchemaSlugs.map(quoteSqlString).join(", ")})
		INNER JOIN "entity" lib ON lib.user_id = ute.user_id
			AND lib.entity_schema_slug = ${quoteSqlString(input.libraryEntitySchema.slug)}
			AND lib.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(input.libraryEntitySchema.pluginId)}
		WHERE ute.id::text > cursor_id
		  AND ute.id::text <= next_cursor_id
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
	END LOOP;

	${buildReportSql("user_to_entity -> in-library relationship", [{ count: "rows_inserted", message: "row(s) migrated total" }])}
END $$;
`;
