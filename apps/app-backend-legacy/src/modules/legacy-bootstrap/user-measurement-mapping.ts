// Migrates V1 user_measurement -> V2 entity (schema slug: "measurement").
//
// V1 user_measurement has a composite PK (user_id, timestamp) — no single UUID id exists.
// Entity ids are derived deterministically: md5(user_id || '|' || timestamp::text).
// Restart-safety is provided by ON CONFLICT ("id") DO NOTHING.
//
// Keyset pagination uses PostgreSQL row comparison (user_id, timestamp) > (cursor_user_id, cursor_ts)
// with a DESC-ordered boundary query to find the end of each batch.
//
// V1 statistics[].value is a Rust Decimal serialized by rust_decimal's default serde as a JSON
// string. The ->> operator extracts it as text; ::float8 handles both string and numeric JSONB
// representations safely.
//
// statistics[].key is a normalized snake_case version of statistics[].name:
//   trim('_' from regexp_replace(lower(name), '[^a-z0-9]+', '_', 'g'))
//
// Entity name uses V1 name when not null/empty, otherwise falls back to
// 'Measurement - YYYY-MM-DD HH24:MI' matching the OpenScale import processor format.
//
// Primary image is migrated from information.assets (remote first, s3 fallback).
// Assets beyond the primary image are not migrated.
//
// V1 has no per-statistic unit field; the unit key is absent from migrated statistics
// (nullish in V2, so omission is valid).

import { quoteSqlString } from "./shared";

export const buildMeasurementMigrationSql = (measurementEntitySchemaId: string) => `
DO $$
DECLARE
	batch_size        constant int := 10000;
	cursor_user_id    text        := '';
	cursor_ts         timestamptz := '-infinity'::timestamptz;
	next_cursor_user_id text;
	next_cursor_ts    timestamptz;
	batch_rows_inserted int;
	rows_inserted     int         := 0;
	started_at        timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"user_measurement"') IS NULL THEN
		RAISE EXCEPTION 'Expected user_measurement table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'user_measurement -> entity: migration started (% seconds elapsed)', 0.0;

	LOOP
		WITH batch AS (
			SELECT um.user_id, um.timestamp
			FROM "user_measurement" um
			WHERE (um.user_id, um.timestamp) > (cursor_user_id, cursor_ts)
			ORDER BY um.user_id, um.timestamp
			LIMIT batch_size
		)
		SELECT user_id, timestamp
		INTO next_cursor_user_id, next_cursor_ts
		FROM batch
		ORDER BY user_id DESC, timestamp DESC
		LIMIT 1;

		EXIT WHEN next_cursor_user_id IS NULL;

		INSERT INTO "entity" (
			"id",
			"user_id",
			"entity_schema_id",
			"name",
			"image",
			"properties",
			"created_at",
			"updated_at"
		)
		SELECT
			md5(um.user_id || '|' || um.timestamp::text),
			um.user_id,
			${quoteSqlString(measurementEntitySchemaId)},
			COALESCE(NULLIF(um.name, ''), 'Measurement - ' || to_char(um.timestamp, 'YYYY-MM-DD HH24:MI')),
			CASE
				WHEN jsonb_array_length(COALESCE(um.information -> 'assets' -> 'remote_images', '[]'::jsonb)) > 0
					THEN jsonb_build_object('type', 'remote', 'url', um.information -> 'assets' -> 'remote_images' ->> 0)
				WHEN jsonb_array_length(COALESCE(um.information -> 'assets' -> 's3_images', '[]'::jsonb)) > 0
					THEN jsonb_build_object('type', 's3', 'key', um.information -> 'assets' -> 's3_images' ->> 0)
				ELSE NULL
			END,
			jsonb_strip_nulls(jsonb_build_object(
				'comment',    NULLIF(um.comment, ''),
				'recordedAt', to_char(um.timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
				'statistics', COALESCE(
					(
						SELECT jsonb_agg(jsonb_build_object(
							'value', (stat->>'value')::float8,
							'label', stat->>'name',
							'key',   trim('_' from regexp_replace(lower(stat->>'name'), '[^a-z0-9]+', '_', 'g'))
						))
						FROM jsonb_array_elements(um.information -> 'statistics') AS stat
						WHERE stat->>'name' IS NOT NULL
					),
					'[]'::jsonb
				)
			)),
			um.timestamp,
			um.timestamp
		FROM "user_measurement" um
		WHERE (um.user_id, um.timestamp) > (cursor_user_id, cursor_ts)
		  AND (um.user_id, um.timestamp) <= (next_cursor_user_id, next_cursor_ts)
		ON CONFLICT ("id") DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted     := rows_inserted + batch_rows_inserted;
		cursor_user_id    := next_cursor_user_id;
		cursor_ts         := next_cursor_ts;
	END LOOP;

	RAISE NOTICE 'user_measurement -> entity: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
