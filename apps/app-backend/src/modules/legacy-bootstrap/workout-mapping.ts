import { quoteSqlString } from "./shared";

// V1 stores Option<Decimal> as JSON strings (rust_decimal serde serializes to string).
// V2 expects `z.number().nullish()`.  Casts a JSONB statistic field to float8.
const buildDecimalStatField = (statAlias: string, field: string) =>
	`NULLIF(${statAlias} -> 'statistic' ->> '${field}', '')::float8`;

// Shared SQL fragment that renames V1 snake_case EntityAssets keys to V2 camelCase and
// lowercases the remote-video source enum (V1 stores "Youtube"/"Dailymotion", V2 expects
// "youtube"/"dailymotion").
const buildAssetsConversionSql = (assetsExpr: string) => `CASE
	WHEN ${assetsExpr} IS NOT NULL
		AND ${assetsExpr} <> 'null'::jsonb
	THEN jsonb_build_object(
		's3Images',     COALESCE(${assetsExpr} -> 's3_images', '[]'::jsonb),
		's3Videos',     COALESCE(${assetsExpr} -> 's3_videos', '[]'::jsonb),
		'remoteImages', COALESCE(${assetsExpr} -> 'remote_images', '[]'::jsonb),
		'remoteVideos', COALESCE(
			(
				SELECT jsonb_agg(jsonb_build_object(
					'url',    rv ->> 'url',
					'source', lower(rv ->> 'source')
				))
				FROM jsonb_array_elements(${assetsExpr} -> 'remote_videos') AS rv
			),
			'[]'::jsonb
		)
	)
	ELSE NULL
END`;

// V1 workout_template.information.exercises[] uses the same ProcessedExercise type as
// completed workouts (with full set statistics). V2 workoutTemplateExerciseSchema uses a
// simplified set structure.  Fields dropped per-set: statistic.pace, statistic.one_rm,
// statistic.volume, totals, confirmed_at, rest_timer_started_at, personal_bests, rest_time.
// Fields dropped per-exercise: lot, unit_system, assets, total.
export const buildWorkoutTemplateMigrationSql = (workoutTemplateEntitySchemaId: string) => `
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

	RAISE NOTICE 'workout_template -> entity: migration started (% seconds elapsed)', 0.0;

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
			"entity_schema_id",
			"properties",
			"created_at",
			"updated_at"
		)
		SELECT
			wt.id,
			wt.name,
			wt.user_id,
			${quoteSqlString(workoutTemplateEntitySchemaId)},
			jsonb_strip_nulls(jsonb_build_object(
				'comment',  NULLIF(wt.information ->> 'comment', ''),
				'assets',   ${buildAssetsConversionSql("wt.information -> 'assets'")},
				'supersets', COALESCE(wt.information -> 'supersets', '[]'::jsonb),
				'exercises', COALESCE(
					(
						SELECT jsonb_agg(
							jsonb_build_object(
								'exerciseId',    ex.value ->> 'id',
								'exerciseOrder', (ex.ordinality - 1)::int,
								'notes',         COALESCE(ex.value -> 'notes', '[]'::jsonb),
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

	RAISE NOTICE 'workout_template -> entity: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

// Dropped fields: workout.duration (derivable from endedAt - startedAt), workout.summary
// (computed aggregate, not stored in V2).
// Timestamps are converted to ISO 8601 UTC strings via to_char(...AT TIME ZONE 'UTC', ...).
export const buildWorkoutMigrationSql = (workoutEntitySchemaId: string) => `
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

	RAISE NOTICE 'workout -> entity: migration started (% seconds elapsed)', 0.0;

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
			"entity_schema_id",
			"properties",
			"created_at",
			"updated_at"
		)
		SELECT
			w.id,
			w.name,
			w.user_id,
			${quoteSqlString(workoutEntitySchemaId)},
			jsonb_strip_nulls(jsonb_build_object(
				'startedAt',     to_char(w.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
				'endedAt',       to_char(w.end_time   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
				'comment',       NULLIF(w.information ->> 'comment', ''),
				'caloriesBurnt', w.calories_burnt,
				'assets',        ${buildAssetsConversionSql("w.information -> 'assets'")},
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

	RAISE NOTICE 'workout -> entity: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

// Each V1 set (workout.information.exercises[i].sets[j]) becomes one event row.
// event.entity_id    = exercise entity id (V1 exercise.id, preserved during exercise migration)
// event.session_entity_id = workout entity id (V1 workout.id, preserved in phase 2)
// Deterministic event id = md5(workout_id ':' exercise_idx ':' set_idx) for restart-safety
// since the event table has no unique constraint beyond the PK.
//
// V1 unit_system is PascalCase ("Metric"/"Imperial"); lower() normalises to V2 camelCase values.
// confirmed_at and rest_timer_started_at are already ISO 8601 strings in the V1 JSONB.
// personal_bests enum values are snake_case in both V1 and V2 — no conversion needed.
export const buildWorkoutSetEventMigrationSql = (workoutSetEventSchemaId: string) => `
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

	RAISE NOTICE 'workout sets -> event: migration started (% seconds elapsed)', 0.0;

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
			"event_schema_id",
			"properties",
			"created_at",
			"occurred_at"
		)
		SELECT
			md5(w.id || ':' || (ex.ordinality - 1)::text || ':' || (s.ordinality - 1)::text),
			w.user_id,
			ex.value ->> 'id',
			w.id,
			${quoteSqlString(workoutSetEventSchemaId)},
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
				'exerciseAssets',     ${buildAssetsConversionSql("ex.value -> 'assets'")},
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

	RAISE NOTICE 'workout sets -> event: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

// Deterministic relationship id = md5(workout_id ':workout-to-workout-template') for
// restart-safety. The relationship table unique constraint on (user_id, source_entity_id,
// target_entity_id, relationship_schema_id) also catches duplicates via ON CONFLICT DO NOTHING.
export const buildWorkoutToTemplateRelationshipMigrationSql = (
	workoutToWorkoutTemplateRelationshipSchemaId: string,
) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"workout"') IS NULL THEN
		RAISE EXCEPTION 'Expected workout table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'workout -> workout-to-workout-template relationship: migration started (% seconds elapsed)', 0.0;

	INSERT INTO "relationship" (
		"id",
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_id",
		"properties"
	)
	SELECT
		md5(w.id || ':workout-to-workout-template'),
		w.user_id,
		w.id,
		w.template_id,
		${quoteSqlString(workoutToWorkoutTemplateRelationshipSchemaId)},
		'{}'::jsonb
	FROM "workout" w
	WHERE w.template_id IS NOT NULL
	ON CONFLICT DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	RAISE NOTICE 'workout -> workout-to-workout-template relationship: % row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

// Deterministic relationship id = md5(workout_id ':workout-repeated-from') for
// restart-safety. The relationship table unique constraint on (user_id, source_entity_id,
// target_entity_id, relationship_schema_id) also catches duplicates via ON CONFLICT DO NOTHING.
export const buildWorkoutRepeatedFromRelationshipMigrationSql = (
	workoutRepeatedFromRelationshipSchemaId: string,
) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"workout"') IS NULL THEN
		RAISE EXCEPTION 'Expected workout table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'workout -> workout-repeated-from relationship: migration started (% seconds elapsed)', 0.0;

	INSERT INTO "relationship" (
		"id",
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_id",
		"properties"
	)
	SELECT
		md5(w.id || ':workout-repeated-from'),
		w.user_id,
		w.id,
		w.repeated_from,
		${quoteSqlString(workoutRepeatedFromRelationshipSchemaId)},
		'{}'::jsonb
	FROM "workout" w
	WHERE w.repeated_from IS NOT NULL
	ON CONFLICT DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	RAISE NOTICE 'workout -> workout-repeated-from relationship: % row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
