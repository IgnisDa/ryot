import { sql } from "drizzle-orm";

import type { DbClient } from "~/lib/db";

import {
	type EntityMigrationTarget,
	type ResolvedEntityMigrationTarget,
	buildEntityTargetValuesSql,
	buildPrimaryImageSql,
} from "./shared";

export const exerciseEntityTargets = [
	{ source: "custom", entitySchemaSlug: "exercise", sandboxScriptSlug: null },
	{
		source: "github",
		entitySchemaSlug: "exercise",
		sandboxScriptSlug: "exercise.free-exercise-db",
	},
] as const satisfies readonly EntityMigrationTarget[];

const exerciseEntityTargetValuesSql = sql.join(
	exerciseEntityTargets.map(
		(target) => sql`(${target.source}, ${target.entitySchemaSlug}, ${target.sandboxScriptSlug})`,
	),
	sql`, `,
);

const supportedExerciseLots = [
	"reps",
	"duration",
	"reps_and_weight",
	"reps_and_duration",
	"distance_and_duration",
	"reps_and_duration_and_distance",
] as const;

const supportedExerciseLotValuesSql = sql.join(
	supportedExerciseLots.map((lot) => sql`(${lot})`),
	sql`, `,
);

const buildLegacyImageArraySql = (tableAlias: string) => `(
	COALESCE(
		(
			SELECT jsonb_agg(
				jsonb_build_object('type', 'remote', 'url', remote_image)
				ORDER BY ordinality
			)
			FROM jsonb_array_elements_text(COALESCE(${tableAlias}.assets -> 'remote_images', '[]'::jsonb))
				WITH ORDINALITY AS remote(remote_image, ordinality)
		),
		'[]'::jsonb
	)
	||
	COALESCE(
		(
			SELECT jsonb_agg(
				jsonb_build_object('type', 's3', 'key', s3_image)
				ORDER BY ordinality
			)
			FROM jsonb_array_elements_text(COALESCE(${tableAlias}.assets -> 's3_images', '[]'::jsonb))
				WITH ORDINALITY AS s3(s3_image, ordinality)
		),
		'[]'::jsonb
	)
)`;

export const getUnsupportedExerciseSources = async (database: DbClient) => {
	const result = await database.execute<{ source: string }>(sql`
		WITH exercise_targets (source, entity_schema_slug, sandbox_script_slug) AS (
			VALUES ${exerciseEntityTargetValuesSql}
		)
		SELECT DISTINCT
			exercise.source AS source
		FROM "exercise" exercise
		LEFT JOIN exercise_targets ON exercise_targets.source = exercise.source
		WHERE exercise_targets.source IS NULL
		ORDER BY exercise.source
	`);

	return result.rows;
};

export const getUnsupportedExerciseLots = async (database: DbClient) => {
	const result = await database.execute<{ lot: string }>(sql`
		WITH supported_lots (lot) AS (
			VALUES ${supportedExerciseLotValuesSql}
		)
		SELECT DISTINCT
			exercise.lot AS lot
		FROM "exercise" exercise
		LEFT JOIN supported_lots ON supported_lots.lot = exercise.lot
		WHERE supported_lots.lot IS NULL
		ORDER BY exercise.lot
	`);

	return result.rows;
};

export const getInvalidExerciseGithubOwnership = async (database: DbClient) => {
	const result = await database.execute<{ id: string }>(sql`
		SELECT DISTINCT
			exercise.id AS id
		FROM "exercise" exercise
		WHERE exercise.source = 'github'
			AND exercise.created_by_user_id IS NOT NULL
		ORDER BY exercise.id
	`);

	return result.rows;
};

export const buildExerciseMigrationSql = (targets: ResolvedEntityMigrationTarget[]) => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"exercise"') IS NULL THEN
		RAISE EXCEPTION 'Expected exercise table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'exercise -> entity: migration started (% seconds elapsed)', 0.0;

	LOOP
		WITH exercise_targets (source, entity_schema_id, sandbox_script_id) AS (
			VALUES ${buildEntityTargetValuesSql(targets)}
		), batch AS (
			SELECT exercise.id::text AS id
			FROM "exercise" exercise
			INNER JOIN exercise_targets ON exercise_targets.source = exercise.source
			WHERE exercise.id::text > cursor_id
			ORDER BY exercise.id::text
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		WITH exercise_targets (source, entity_schema_id, sandbox_script_id) AS (
			VALUES ${buildEntityTargetValuesSql(targets)}
		)
		INSERT INTO "entity" (
			"id",
			"external_id",
			"name",
			"image",
			"created_at",
			"populated_at",
			"user_id",
			"properties",
			"entity_schema_id",
			"sandbox_script_id",
			"updated_at"
		)
		SELECT
			exercise.id,
			exercise.id,
			exercise.name,
			${buildPrimaryImageSql("exercise")},
			NOW(),
			NOW(),
			CASE WHEN exercise.source = 'github' THEN NULL ELSE exercise.created_by_user_id END,
			jsonb_strip_nulls(
				jsonb_build_object(
					'kind', exercise.lot,
					'images', ${buildLegacyImageArraySql("exercise")},
					'muscles', COALESCE(to_jsonb(exercise.muscles), '[]'::jsonb),
					'instructions', COALESCE(to_jsonb(exercise.instructions), '[]'::jsonb),
					'force', exercise.force,
					'level', exercise.level,
					'mechanic', exercise.mechanic,
					'equipment', exercise.equipment
				)
			),
			exercise_targets.entity_schema_id,
			exercise_targets.sandbox_script_id,
			NOW()
		FROM "exercise" exercise
		INNER JOIN exercise_targets ON exercise_targets.source = exercise.source
		WHERE exercise.id::text > cursor_id
			AND exercise.id::text <= next_cursor_id
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
		RAISE NOTICE 'exercise -> entity: % row(s) migrated so far (% seconds elapsed)',
			rows_inserted,
			round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
	END LOOP;

	RAISE NOTICE 'exercise -> entity: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
