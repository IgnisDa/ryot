import { DatabaseSession } from "@ryot-app/kernel-backend/lib/infrastructure/db/session";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { buildLegacyImagesSql, buildLegacyVideosSql } from "./asset-mapping";
import {
	buildAbortOnRowsSql,
	buildAnomalyReportSql,
	type EntityMigrationTarget,
	type ResolvedEntityMigrationTarget,
	buildEntityTargetValuesSql,
	buildRequireLegacyTableSql,
	buildReportSql,
} from "./shared";

export const exerciseEntityTargets = [
	{ source: "custom", providerSlug: null, entitySchemaSlug: "exercise" },
	{ source: "github", entitySchemaSlug: "exercise", providerSlug: "exercise.free-exercise-db" },
] as const satisfies readonly EntityMigrationTarget[];

const exerciseEntityTargetValuesSql = sql.join(
	exerciseEntityTargets.map(
		(target) => sql`(${target.source}, ${target.entitySchemaSlug}, ${target.providerSlug})`,
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

const exerciseHasLegacyReferencesSql = (exerciseAlias: string) => `(
	EXISTS (
		SELECT 1 FROM "user_to_entity" user_to_entity
		WHERE user_to_entity.exercise_id::text = ${exerciseAlias}.id::text
	)
	OR EXISTS (
		SELECT 1 FROM "review" review
		WHERE review.exercise_id::text = ${exerciseAlias}.id::text
	)
	OR EXISTS (
		SELECT 1 FROM "collection_to_entity" collection_to_entity
		WHERE collection_to_entity.exercise_id::text = ${exerciseAlias}.id::text
	)
	OR EXISTS (
		SELECT 1
		FROM "workout" workout
		CROSS JOIN LATERAL jsonb_array_elements(
			CASE
				WHEN jsonb_typeof(workout.information -> 'exercises') = 'array'
				THEN workout.information -> 'exercises'
				ELSE '[]'::jsonb
			END
		) AS workout_exercise(value)
		WHERE workout_exercise.value ->> 'id' = ${exerciseAlias}.id::text
	)
	OR EXISTS (
		SELECT 1
		FROM "workout_template" workout_template
		CROSS JOIN LATERAL jsonb_array_elements(
			CASE
				WHEN jsonb_typeof(workout_template.information -> 'exercises') = 'array'
				THEN workout_template.information -> 'exercises'
				ELSE '[]'::jsonb
			END
		) AS template_exercise(value)
		WHERE template_exercise.value ->> 'id' = ${exerciseAlias}.id::text
	)
)`;

const ownerlessUnreferencedExerciseSourceSql = `
	SELECT
		exercise.id::text AS id,
		exercise.name AS name,
		exercise.source AS source,
		exercise.muscles AS muscles,
		exercise.equipment AS equipment,
		exercise.assets AS assets,
		exercise.created_by_user_id AS creator_user_id
	FROM "exercise" exercise
	WHERE exercise.source = 'custom'
		AND exercise.created_by_user_id IS NULL
		AND NOT ${exerciseHasLegacyReferencesSql("exercise")}
`;

export const getUnsupportedExerciseSources = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	const result = yield* session.run((database) =>
		database.execute<{ source: string }>(
			sql`
			WITH exercise_targets (source, entity_schema_slug, provider_slug) AS (
				VALUES ${exerciseEntityTargetValuesSql}
			)
			SELECT DISTINCT
				exercise.source AS source
			FROM "exercise" exercise
			LEFT JOIN exercise_targets ON exercise_targets.source = exercise.source
			WHERE exercise_targets.source IS NULL
			ORDER BY exercise.source
		`,
			"objects",
		),
	);

	return result;
});

export const getUnsupportedExerciseLots = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	const result = yield* session.run((database) =>
		database.execute<{ lot: string }>(
			sql`
			WITH supported_lots (lot) AS (
				VALUES ${supportedExerciseLotValuesSql}
			)
			SELECT DISTINCT
				exercise.lot AS lot
			FROM "exercise" exercise
			LEFT JOIN supported_lots ON supported_lots.lot = exercise.lot
			WHERE supported_lots.lot IS NULL
			ORDER BY exercise.lot
		`,
			"objects",
		),
	);

	return result;
});

export const getInvalidExerciseGithubOwnership = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	const result = yield* session.run((database) =>
		database.execute<{ id: string }>(
			sql`
			SELECT DISTINCT
				exercise.id AS id
			FROM "exercise" exercise
			WHERE exercise.source = 'github'
				AND exercise.created_by_user_id IS NOT NULL
			ORDER BY exercise.id
		`,
			"objects",
		),
	);

	return result;
});

export const buildExerciseMigrationSql = (targets: ResolvedEntityMigrationTarget[]) => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	ownerless_exercise_report_seq int;
	ownerless_exercise_count int;
	ownerless_exercise_sample text;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("exercise -> entity", "exercise")}
	${buildRequireLegacyTableSql("exercise -> entity", "user_to_entity")}
	${buildRequireLegacyTableSql("exercise -> entity", "review")}
	${buildRequireLegacyTableSql("exercise -> entity", "collection_to_entity")}
	${buildRequireLegacyTableSql("exercise -> entity", "workout")}
	${buildRequireLegacyTableSql("exercise -> entity", "workout_template")}

	${buildAbortOnRowsSql({
		countVariable: "ownerless_exercise_count",
		sampleVariable: "ownerless_exercise_sample",
		source: `
			SELECT exercise.id::text AS label
			FROM "exercise" exercise
			WHERE exercise.source = 'custom'
				AND exercise.created_by_user_id IS NULL
				AND ${exerciseHasLegacyReferencesSql("exercise")}
		`,
		message:
			"exercise -> entity: % custom exercise(s) have no creator but are referenced by user data, so omitting them would lose linked data and there is no owner to assign: %. Set a creator on those rows in V1 or remove every listed reference, then start the server again.",
	})}

	${buildAnomalyReportSql({
		phase: "exercise -> entity",
		code: "exercise-ownerless-unreferenced",
		countVariable: "ownerless_exercise_count",
		seqVariable: "ownerless_exercise_report_seq",
		source: `(${ownerlessUnreferencedExerciseSourceSql}) ownerless_exercise`,
		message:
			"Unreferenced custom exercises with no creator were omitted because V2 custom exercises require an owner. Each omitted row is listed below with its taxonomy and asset data.",
		detail: `jsonb_build_object(
			'code', 'exercise-ownerless-unreferenced',
			'legacyRecordId', ownerless_exercise.id,
			'name', ownerless_exercise.name,
			'source', ownerless_exercise.source,
			'muscles', to_jsonb(ownerless_exercise.muscles),
			'equipment', ownerless_exercise.equipment,
			'assets', ownerless_exercise.assets,
			'creatorUserId', ownerless_exercise.creator_user_id
		)`,
	})}

	LOOP
		WITH exercise_targets (source, entity_schema_slug, entity_schema_plugin_id, provider_id) AS (
			VALUES ${buildEntityTargetValuesSql(targets)}
		), batch AS (
			SELECT exercise.id::text AS id
			FROM "exercise" exercise
			INNER JOIN exercise_targets ON exercise_targets.source = exercise.source
			WHERE NOT (
				exercise.source = 'custom'
				AND exercise.created_by_user_id IS NULL
			)
				AND exercise.id::text > cursor_id
			ORDER BY exercise.id::text
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		WITH exercise_targets (source, entity_schema_slug, entity_schema_plugin_id, provider_id) AS (
			VALUES ${buildEntityTargetValuesSql(targets)}
		)
		INSERT INTO "entity" (
			"id",
			"external_id",
			"name",
			"created_at",
			"populated_at",
			"user_id",
			"properties",
			"entity_schema_slug",
			"entity_schema_plugin_id",
			"provider_id",
			"updated_at"
		)
		SELECT
			exercise.id,
			exercise.id,
			exercise.name,
			NOW(),
			CASE WHEN exercise.source = 'github' THEN NULL ELSE NOW() END,
			CASE WHEN exercise.source = 'github' THEN NULL ELSE exercise.created_by_user_id END,
			jsonb_strip_nulls(
				jsonb_build_object(
					'kind', exercise.lot,
					'images', ${buildLegacyImagesSql("exercise.assets")},
					'videos', ${buildLegacyVideosSql("exercise.assets")},
					'instructions', COALESCE(to_jsonb(exercise.instructions), '[]'::jsonb),
					'force', exercise.force,
					'level', exercise.level,
					'mechanic', exercise.mechanic
				)
			),
			exercise_targets.entity_schema_slug,
			exercise_targets.entity_schema_plugin_id,
			exercise_targets.provider_id,
			NOW()
		FROM "exercise" exercise
		INNER JOIN exercise_targets ON exercise_targets.source = exercise.source
		WHERE exercise.id::text > cursor_id
			AND exercise.id::text <= next_cursor_id
			AND NOT (
				exercise.source = 'custom'
				AND exercise.created_by_user_id IS NULL
			)
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
	END LOOP;

	${buildReportSql("exercise -> entity", [{ count: "rows_inserted", message: "row(s) migrated total" }])}
END $$;
`;
