import { quoteSqlString } from "./shared";

export const buildUserToEntityInLibraryMigrationSql = (
	inLibraryRelationshipSchemaId: string,
	libraryEntitySchemaId: string,
) => `
DO $$
DECLARE
	batch_size          constant int := 10000;
	batch_rows_inserted int;
	cursor_id           text         := '';
	next_cursor_id      text;
	rows_inserted       int          := 0;
	started_at          timestamptz  := clock_timestamp();
BEGIN
	IF to_regclass('"user_to_entity"') IS NULL THEN
		RAISE EXCEPTION 'Expected user_to_entity table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'user_to_entity -> in-library relationship: migration started (% seconds elapsed)', 0.0;

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
			"relationship_schema_id",
			"properties",
			"created_at"
		)
		SELECT
			md5(ute.entity_id || ':in-library:' || ute.user_id),
			ute.user_id,
			ute.entity_id,
			lib.id,
			${quoteSqlString(inLibraryRelationshipSchemaId)},
			'{}'::jsonb,
			ute.created_on
		FROM "user_to_entity" ute
		INNER JOIN "entity" src ON src.id = ute.entity_id AND src.user_id IS NULL
		INNER JOIN "entity" lib ON lib.user_id = ute.user_id
			AND lib.entity_schema_id = ${quoteSqlString(libraryEntitySchemaId)}
		WHERE ute.id::text > cursor_id
		  AND ute.id::text <= next_cursor_id
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
	END LOOP;

	RAISE NOTICE 'user_to_entity -> in-library relationship: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
