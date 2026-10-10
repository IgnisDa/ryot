import { exerciseKinds } from "@ryot-app/fitness-plugin/exercise-kinds";
import { workoutSetScales } from "@ryot-app/fitness-plugin/workout-records";

import { buildLegacyImagesSql, buildLegacyVideosSql } from "./asset-mapping";
import type { QualifiedSchema } from "./migration-resolution";
import {
	buildAbortOnRowsSql,
	buildAnomalyReportSql,
	buildRequireLegacyTableSql,
	buildReportSql,
	quoteNullableSqlString,
	quoteSqlString,
} from "./shared";

const buildDecimalStatField = (statAlias: string, field: string) =>
	`NULLIF(${statAlias} -> 'statistic' ->> '${field}', '')::numeric`;

export const buildWorkoutTemplateMigrationSql = (schema: QualifiedSchema) => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	invalid_unit_count int;
	invalid_unit_sample text;
	invalid_rest_count int;
	invalid_rest_sample text;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("workout -> entity", "workout_template")}
	IF EXISTS (SELECT 1 FROM "migration_report" WHERE phase = 'workout_template -> entity') THEN
		RETURN;
	END IF;
	${buildAbortOnRowsSql({
		countVariable: "invalid_unit_count",
		sampleVariable: "invalid_unit_sample",
		message:
			"workout_template -> entity: % exercise(s) have a missing or unsupported unit system: %. Template measurements cannot be converted safely. Correct these unit systems in the V1 database, then start again.",
		source: `SELECT wt.id || ':' || (ex.ordinality - 1)::text AS label
			FROM "workout_template" wt
			CROSS JOIN LATERAL jsonb_array_elements(COALESCE(wt.information -> 'exercises', '[]'::jsonb)) WITH ORDINALITY AS ex(value, ordinality)
			WHERE COALESCE(lower(ex.value ->> 'unit_system'), '') NOT IN ('metric', 'imperial')`,
	})}
	${buildAbortOnRowsSql({
		countVariable: "invalid_rest_count",
		sampleVariable: "invalid_rest_sample",
		message:
			"workout_template -> entity: % set(s) have an invalid rest time: %. Rest times must be nonnegative whole seconds. Correct those values in the V1 database, then start again.",
		source: `SELECT wt.id || ':' || (ex.ordinality - 1)::text || ':' || (s.ordinality - 1)::text AS label
			FROM "workout_template" wt
			CROSS JOIN LATERAL jsonb_array_elements(COALESCE(wt.information -> 'exercises', '[]'::jsonb)) WITH ORDINALITY AS ex(value, ordinality)
			CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ex.value -> 'sets', '[]'::jsonb)) WITH ORDINALITY AS s(value, ordinality)
			WHERE s.value -> 'rest_time' IS NOT NULL AND s.value -> 'rest_time' <> 'null'::jsonb
				AND NOT CASE WHEN jsonb_typeof(s.value -> 'rest_time') = 'number'
					THEN (s.value ->> 'rest_time')::numeric >= 0 AND (s.value ->> 'rest_time')::numeric = trunc((s.value ->> 'rest_time')::numeric)
					ELSE false END`,
	})}

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
												'restTime', s.value -> 'rest_time',
												'reps',     ${buildDecimalStatField("s.value", "reps")},
												'weight',   round(${buildDecimalStatField("s.value", "weight")} * CASE WHEN lower(ex.value ->> 'unit_system') = 'imperial' THEN 0.45359237 ELSE 1 END, ${workoutSetScales.weight}),
												'duration', round(${buildDecimalStatField("s.value", "duration")} * 60, ${workoutSetScales.duration}),
												'distance', round(${buildDecimalStatField("s.value", "distance")} * CASE WHEN lower(ex.value ->> 'unit_system') = 'imperial' THEN 1.609344 ELSE 1 END, ${workoutSetScales.distance})
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

export const buildWorkoutMigrationSql = (schema: QualifiedSchema) => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	invalid_energy_unit_count int;
	invalid_energy_unit_sample text;
	invalid_energy_value_count int;
	invalid_energy_value_sample text;
	anomaly_count int;
	anomaly_seq bigint;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("workout -> entity", "workout")}
	IF EXISTS (SELECT 1 FROM "migration_report" WHERE phase = 'workout -> entity') THEN
		RETURN;
	END IF;
	${buildAbortOnRowsSql({
		countVariable: "invalid_energy_value_count",
		sampleVariable: "invalid_energy_value_sample",
		source: `SELECT id AS label FROM "workout" WHERE calories_burnt::text IN ('NaN', 'Infinity', '-Infinity')`,
		message:
			"workout -> entity: % workout(s) have a nonfinite energy value: %. Energy must be a finite kcal quantity. Correct those values in the V1 database, then start again.",
	})}
	${buildAbortOnRowsSql({
		countVariable: "invalid_energy_unit_count",
		sampleVariable: "invalid_energy_unit_sample",
		source: `SELECT w.id AS label FROM "workout" w
			JOIN "old_user" legacy_user ON legacy_user.id = w.user_id
			WHERE w.calories_burnt >= 0
				AND COALESCE(lower(btrim(legacy_user.preferences #>> '{fitness,logging,calories_burnt_unit}')), 'kcal') <> 'kcal'`,
		message:
			"workout -> entity: % workout(s) have nonnegative energy history with a non-kcal user preference: %. V1 stored no per-workout unit, so the current label cannot prove the historical unit. Confirm and convert these V1 energy values to kcal and correct the preference, then start again; do not just relabel unknown values.",
	})}

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
				'startedAt',     to_char(w.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
				'endedAt',       to_char(w.end_time   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
				'comment',       NULLIF(w.information ->> 'comment', ''),
				'activeDuration', CASE WHEN w.duration >= 0 THEN w.duration END,
				'caloriesBurnt', CASE WHEN w.calories_burnt >= 0 THEN w.calories_burnt END,
				'images',        ${buildLegacyImagesSql("w.information -> 'assets'")},
				'videos',        ${buildLegacyVideosSql("w.information -> 'assets'")},
				'exerciseNotes', COALESCE(
					(
						SELECT jsonb_agg(
							jsonb_build_object(
								'exerciseOrder', (ex.ordinality - 1)::int,
								'notes', ex.value -> 'notes'
							)
							ORDER BY ex.ordinality
						)
						FROM jsonb_array_elements(COALESCE(w.information -> 'exercises', '[]'::jsonb))
							WITH ORDINALITY AS ex(value, ordinality)
						WHERE jsonb_array_length(COALESCE(ex.value -> 'notes', '[]'::jsonb)) > 0
					),
					'[]'::jsonb
				),
				'exerciseMedia', COALESCE(
					(
						SELECT jsonb_agg(
							jsonb_build_object(
								'exerciseOrder', (ex.ordinality - 1)::int,
								'images', COALESCE(${buildLegacyImagesSql("ex.value -> 'assets'")}, '[]'::jsonb),
								'videos', COALESCE(${buildLegacyVideosSql("ex.value -> 'assets'")}, '[]'::jsonb)
							)
							ORDER BY ex.ordinality
						)
						FROM jsonb_array_elements(COALESCE(w.information -> 'exercises', '[]'::jsonb))
							WITH ORDINALITY AS ex(value, ordinality)
					),
					'[]'::jsonb
				),
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
	${buildAnomalyReportSql({
		phase: "workout -> entity",
		seqVariable: "anomaly_seq",
		countVariable: "anomaly_count",
		code: "workout-active-duration-invalid",
		source: '(SELECT * FROM "workout" WHERE duration < 0) invalid_workout',
		message:
			"Negative recorded workout durations were omitted as unknown. Original values and timestamps are retained in report details; timestamps were not changed.",
		detail: `jsonb_build_object(
			'code', 'workout-active-duration-invalid',
			'userId', invalid_workout.user_id,
			'workoutId', invalid_workout.id,
			'legacyValue', invalid_workout.duration::text,
			'startedAt', invalid_workout.start_time::text,
			'endedAt', invalid_workout.end_time::text
		)`,
	})}
	${buildAnomalyReportSql({
		phase: "workout -> entity",
		seqVariable: "anomaly_seq",
		code: "workout-energy-invalid",
		countVariable: "anomaly_count",
		message:
			"Negative recorded workout energy values were omitted as unknown. Original values, units, and timestamps are retained in report details.",
		source: `(SELECT w.*, legacy_user.preferences #>> '{fitness,logging,calories_burnt_unit}' AS legacy_energy_unit
			FROM "workout" w JOIN "old_user" legacy_user ON legacy_user.id = w.user_id
			WHERE w.calories_burnt < 0) invalid_workout`,
		detail: `jsonb_build_object(
			'code', 'workout-energy-invalid',
			'userId', invalid_workout.user_id,
			'workoutId', invalid_workout.id,
			'legacyValue', invalid_workout.calories_burnt::text,
			'legacyEnergyUnit', invalid_workout.legacy_energy_unit,
			'startedAt', invalid_workout.start_time::text,
			'endedAt', invalid_workout.end_time::text
		)`,
	})}

	${buildReportSql("workout -> entity", [{ count: "rows_inserted", message: "row(s) migrated total" }])}
END $$;
`;

export const buildWorkoutSetEventMigrationSql = (schema: QualifiedSchema) => `
DO $$
DECLARE
	batch_size constant int := 1000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	invalid_confirmed_at_count int;
	invalid_confirmed_at_sample text;
	invalid_lot_count int;
	invalid_lot_sample text;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("workout -> entity", "workout")}
	${buildAbortOnRowsSql({
		countVariable: "invalid_confirmed_at_count",
		sampleVariable: "invalid_confirmed_at_sample",
		message:
			"workout -> event: % set(s) have a non-empty confirmed_at value that is not a valid timestamp: %. The event time cannot be determined without changing the recorded completion time. Fix or delete those set values in the V1 database, then start the server again.",
		source: `
			SELECT w.id || ':' || (ex.ordinality - 1)::text || ':' || (s.ordinality - 1)::text AS label
			FROM "workout" w
			CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.information -> 'exercises', '[]'::jsonb))
				WITH ORDINALITY AS ex(value, ordinality)
			CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ex.value -> 'sets', '[]'::jsonb))
				WITH ORDINALITY AS s(value, ordinality)
			WHERE NULLIF(s.value ->> 'confirmed_at', '') IS NOT NULL
				AND NOT pg_input_is_valid(s.value ->> 'confirmed_at', 'timestamp with time zone')
		`,
	})}
	${buildAbortOnRowsSql({
		countVariable: "invalid_lot_count",
		sampleVariable: "invalid_lot_sample",
		message:
			"workout -> event: % workout exercise(s) have a missing or unsupported lot: %. Each set stores the exercise kind it was logged under, so it cannot be migrated without one. Fix those workout exercises in the V1 database, then start the server again.",
		source: `
			SELECT w.id || ':' || (ex.ordinality - 1)::text AS label
			FROM "workout" w
			CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.information -> 'exercises', '[]'::jsonb))
				WITH ORDINALITY AS ex(value, ordinality)
			WHERE COALESCE(ex.value ->> 'lot', '') NOT IN (${exerciseKinds.map((kind) => quoteSqlString(kind)).join(", ")})
		`,
	})}

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
				'exerciseKind',       ex.value ->> 'lot',
				'reps',               ${buildDecimalStatField("s.value", "reps")},
				'weight',             round(CASE
					WHEN lower(ex.value ->> 'unit_system') = 'imperial'
					THEN ${buildDecimalStatField("s.value", "weight")} * 0.45359237
					ELSE ${buildDecimalStatField("s.value", "weight")}
				END, ${workoutSetScales.weight}),
				'duration',           round(${buildDecimalStatField("s.value", "duration")} * 60, ${workoutSetScales.duration}),
				'distance',           round(CASE
					WHEN lower(ex.value ->> 'unit_system') = 'imperial'
					THEN ${buildDecimalStatField("s.value", "distance")} * 1.609344
					ELSE ${buildDecimalStatField("s.value", "distance")}
				END, ${workoutSetScales.distance})
			)),
			w.start_time,
			COALESCE(NULLIF(s.value ->> 'confirmed_at', '')::timestamptz, w.start_time)
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

export const buildWorkoutToTemplateRelationshipMigrationSql = (schema: QualifiedSchema) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("workout -> entity", "workout")}

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

export const buildWorkoutRepeatedFromRelationshipMigrationSql = (schema: QualifiedSchema) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("workout -> entity", "workout")}

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
