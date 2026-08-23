import { buildLegacyImagesSql, buildLegacyVideosSql } from "./asset-mapping";
import type { QualifiedSchema } from "./migration-resolution";
import { buildReportSql, quoteNullableSqlString, quoteSqlString } from "./shared";

// V1 Option<Decimal> is a rust_decimal JSON string; cast to float8.
const buildDecimalStatField = (statAlias: string, field: string) =>
	`NULLIF(${statAlias} -> 'statistic' ->> '${field}', '')::float8`;

// Workout templates use the same set structure as workouts but a simplified per-set shape: the
// per-set statistics/totals/timers/personal_bests and per-exercise lot/unit_system/total are
// dropped while per-exercise media is preserved.
export const buildWorkoutTemplateMigrationSql = (schema: QualifiedSchema) => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"workout_template"') IS NULL THEN
		RAISE EXCEPTION 'Expected workout_template table to exist in a V1 database but it was not found';
	END IF;

	LOOP
		WITH batch AS (
			SELECT wt.id AS id
			FROM "workout_template" wt
			WHERE wt.id > cursor_id
			ORDER BY wt.id
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		INSERT INTO "entity" (
			"id",
			"name",
			"user_id",
			"entity_schema_slug",
			"entity_schema_plugin_id",
			"properties",
			"created_at",
			"updated_at"
		)
		SELECT
			wt.id,
			wt.name,
			wt.user_id,
			${quoteSqlString(schema.slug)},
			${quoteNullableSqlString(schema.pluginId)},
			jsonb_strip_nulls(jsonb_build_object(
				'comment',  NULLIF(wt.information ->> 'comment', ''),
				'images',   ${buildLegacyImagesSql("wt.information -> 'assets'")},
				'videos',   ${buildLegacyVideosSql("wt.information -> 'assets'")},
				'supersets', COALESCE(wt.information -> 'supersets', '[]'::jsonb),
				'exercises', COALESCE(
					(
						SELECT jsonb_agg(
							jsonb_build_object(
								'exerciseId',    ex.value ->> 'id',
								'exerciseOrder', (ex.ordinality - 1)::int,
								'notes',         COALESCE(ex.value -> 'notes', '[]'::jsonb),
								'images',        ${buildLegacyImagesSql("ex.value -> 'assets'")},
								'videos',        ${buildLegacyVideosSql("ex.value -> 'assets'")},
								'sets', COALESCE(
									(
										SELECT jsonb_agg(
											jsonb_strip_nulls(jsonb_build_object(
												'setLot',   s.value ->> 'lot',
												'setOrder', (s.ordinality - 1)::int,
												'rpe',      s.value -> 'rpe',
												'note',     NULLIF(s.value ->> 'note', ''),
												'reps',     ${buildDecimalStatField("s.value", "reps")},
												'weight',   ${buildDecimalStatField("s.value", "weight")},
												'duration', ${buildDecimalStatField("s.value", "duration")},
												'distance', ${buildDecimalStatField("s.value", "distance")}
											))
											ORDER BY s.ordinality
										)
										FROM jsonb_array_elements(COALESCE(ex.value -> 'sets', '[]'::jsonb))
											WITH ORDINALITY AS s(value, ordinality)
									),
									'[]'::jsonb
								)
							)
							ORDER BY ex.ordinality
						)
						FROM jsonb_array_elements(COALESCE(wt.information -> 'exercises', '[]'::jsonb))
							WITH ORDINALITY AS ex(value, ordinality)
					),
					'[]'::jsonb
				)
			)),
			wt.created_on,
			wt.created_on
		FROM "workout_template" wt
		WHERE wt.id > cursor_id
		  AND wt.id <= next_cursor_id
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
	END LOOP;

	${buildReportSql("workout_template -> entity", [{ count: "rows_inserted", message: "row(s) migrated total" }])}
END $$;
`;

// Dropped fields: workout.duration (derivable from endedAt - startedAt), workout.summary
// (computed aggregate, not stored in V2).
// Timestamps are converted to ISO 8601 UTC strings via to_char(...AT TIME ZONE 'UTC', ...).
export const buildWorkoutMigrationSql = (schema: QualifiedSchema) => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"workout"') IS NULL THEN
		RAISE EXCEPTION 'Expected workout table to exist in a V1 database but it was not found';
	END IF;

	LOOP
		WITH batch AS (
			SELECT w.id AS id
			FROM "workout" w
			WHERE w.id > cursor_id
			ORDER BY w.id
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		INSERT INTO "entity" (
			"id",
			"name",
			"user_id",
			"entity_schema_slug",
			"entity_schema_plugin_id",
			"properties",
			"created_at",
			"updated_at"
		)
		SELECT
			w.id,
			w.name,
			w.user_id,
			${quoteSqlString(schema.slug)},
			${quoteNullableSqlString(schema.pluginId)},
			jsonb_strip_nulls(jsonb_build_object(
				'startedAt',     to_char(w.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
				'endedAt',       to_char(w.end_time   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
				'comment',       NULLIF(w.information ->> 'comment', ''),
				'caloriesBurnt', w.calories_burnt,
				'images',        ${buildLegacyImagesSql("w.information -> 'assets'")},
				'videos',        ${buildLegacyVideosSql("w.information -> 'assets'")},
				'supersets',     CASE
					WHEN jsonb_array_length(COALESCE(w.information -> 'supersets', '[]'::jsonb)) > 0
					THEN w.information -> 'supersets'
					ELSE NULL
				END
			)),
			w.start_time,
			w.end_time
		FROM "workout" w
		WHERE w.id > cursor_id
		  AND w.id <= next_cursor_id
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
	END LOOP;

	${buildReportSql("workout -> entity", [{ count: "rows_inserted", message: "row(s) migrated total" }])}
END $$;
`;

// Each V1 set becomes one event: entity_id = exercise id, session_entity_id = workout id, with a
// deterministic id md5(workout_id ':' exercise_idx ':' set_idx) for restart-safety (the event table
// has no unique constraint beyond the PK). unit_system is lowercased to V2 values.
export const buildWorkoutSetEventMigrationSql = (schema: QualifiedSchema) => `
DO $$
DECLARE
	batch_size constant int := 1000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"workout"') IS NULL THEN
		RAISE EXCEPTION 'Expected workout table to exist in a V1 database but it was not found';
	END IF;

	LOOP
		WITH batch AS (
			SELECT w.id AS id
			FROM "workout" w
			WHERE w.id > cursor_id
			ORDER BY w.id
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		INSERT INTO "event" (
			"id",
			"user_id",
			"entity_id",
			"session_entity_id",
			"event_schema_slug",
			"event_schema_plugin_id",
			"properties",
			"created_at",
			"occurred_at"
		)
		SELECT
			md5(w.id || ':' || (ex.ordinality - 1)::text || ':' || (s.ordinality - 1)::text),
			w.user_id,
			ex.value ->> 'id',
			w.id,
			${quoteSqlString(schema.slug)},
			${quoteNullableSqlString(schema.pluginId)},
			jsonb_strip_nulls(jsonb_build_object(
				'setLot',             s.value ->> 'lot',
				'setOrder',           (s.ordinality - 1)::int,
				'exerciseOrder',      (ex.ordinality - 1)::int,
				'rpe',                s.value -> 'rpe',
				'note',               NULLIF(s.value ->> 'note', ''),
				'restTime',           s.value -> 'rest_time',
				'confirmedAt',        s.value ->> 'confirmed_at',
				'restTimerStartedAt', s.value ->> 'rest_timer_started_at',
				'personalBests',      s.value -> 'personal_bests',
				'unitSystem',         lower(ex.value ->> 'unit_system'),
				'images',              ${buildLegacyImagesSql("ex.value -> 'assets'")},
				'videos',              ${buildLegacyVideosSql("ex.value -> 'assets'")},
				'reps',               ${buildDecimalStatField("s.value", "reps")},
				'pace',               ${buildDecimalStatField("s.value", "pace")},
				'weight',             ${buildDecimalStatField("s.value", "weight")},
				'oneRm',              ${buildDecimalStatField("s.value", "one_rm")},
				'volume',             ${buildDecimalStatField("s.value", "volume")},
				'duration',           ${buildDecimalStatField("s.value", "duration")},
				'distance',           ${buildDecimalStatField("s.value", "distance")}
			)),
			w.start_time,
			w.start_time
		FROM "workout" w
		CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.information -> 'exercises', '[]'::jsonb))
			WITH ORDINALITY AS ex(value, ordinality)
		CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ex.value -> 'sets', '[]'::jsonb))
			WITH ORDINALITY AS s(value, ordinality)
		WHERE w.id > cursor_id
		  AND w.id <= next_cursor_id
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
	END LOOP;

	${buildReportSql("workout sets -> event", [{ count: "rows_inserted", message: "row(s) migrated total" }])}
END $$;
`;

// Deterministic relationship id md5(workout_id ':workout-to-workout-template') for restart-safety.
export const buildWorkoutToTemplateRelationshipMigrationSql = (schema: QualifiedSchema) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"workout"') IS NULL THEN
		RAISE EXCEPTION 'Expected workout table to exist in a V1 database but it was not found';
	END IF;

	INSERT INTO "relationship" (
		"id",
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties"
	)
	SELECT
		md5(w.id || ':workout-to-workout-template'),
		w.user_id,
		w.id,
		w.template_id,
		${quoteSqlString(schema.slug)},
		${quoteNullableSqlString(schema.pluginId)},
		'{}'::jsonb
	FROM "workout" w
	WHERE w.template_id IS NOT NULL
	ON CONFLICT DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	${buildReportSql("workout -> workout-to-workout-template relationship", [{ count: "rows_inserted", message: "row(s) migrated" }])}
END $$;
`;

// Deterministic relationship id md5(workout_id ':workout-repeated-from') for restart-safety.
export const buildWorkoutRepeatedFromRelationshipMigrationSql = (schema: QualifiedSchema) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"workout"') IS NULL THEN
		RAISE EXCEPTION 'Expected workout table to exist in a V1 database but it was not found';
	END IF;

	INSERT INTO "relationship" (
		"id",
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties"
	)
	SELECT
		md5(w.id || ':workout-repeated-from'),
		w.user_id,
		w.id,
		w.repeated_from,
		${quoteSqlString(schema.slug)},
		${quoteNullableSqlString(schema.pluginId)},
		'{}'::jsonb
	FROM "workout" w
	WHERE w.repeated_from IS NOT NULL
	ON CONFLICT DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	${buildReportSql("workout -> workout-repeated-from relationship", [{ count: "rows_inserted", message: "row(s) migrated" }])}
END $$;
`;
