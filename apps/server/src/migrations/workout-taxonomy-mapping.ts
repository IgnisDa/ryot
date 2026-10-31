import { exerciseKinds } from "@ryot-app/fitness-plugin/exercise-kinds";
import { WORKOUT_TAXONOMY_LIMIT } from "@ryot-app/fitness-plugin/workout-taxonomy";

import { legacyEquipmentExternalIdSql } from "./exercise-taxonomy-mapping";
import type { QualifiedSchema } from "./migration-resolution";
import {
	buildAbortOnRowsSql,
	buildReportSql,
	buildRequireLegacyTableSql,
	quoteNullableSqlString,
	quoteSqlString,
} from "./shared";
import { legacyWorkoutSetEventIdSql } from "./workout-mapping";

export const buildWorkoutTaxonomyMigrationSql = (input: {
	targetProviderId: string;
	equipmentProviderId: string;
	setEventSchema: QualifiedSchema;
	targetEntitySchema: QualifiedSchema;
	workoutEntitySchema: QualifiedSchema;
	exerciseEntitySchema: QualifiedSchema;
	occurrenceEventSchema: QualifiedSchema;
	equipmentEntitySchema: QualifiedSchema;
}) => `
DO $$
DECLARE
	invalid_rows int;
	invalid_sample text;
	rows_inserted int;
	source_rows int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("workout exercises -> taxonomy events", "workout")}
	${buildRequireLegacyTableSql("workout exercises -> taxonomy events", "exercise")}
	IF EXISTS (SELECT 1 FROM "migration_report" WHERE phase = 'workout exercises -> taxonomy events') THEN
		RETURN;
	END IF;

	${buildAbortOnRowsSql({
		countVariable: "invalid_rows",
		sampleVariable: "invalid_sample",
		source: `SELECT id AS label FROM "workout"
			WHERE information -> 'exercises' IS NOT NULL
				AND jsonb_typeof(information -> 'exercises') IS DISTINCT FROM 'array'`,
		message:
			"workout exercises -> taxonomy events: % workout(s) have a malformed exercise inventory: %. Recorded positions cannot be recovered from a non-array inventory. Correct the identified V1 workout information and restore a fresh copy before retrying.",
	})}

	CREATE TEMP TABLE _legacy_workout_occurrences ON COMMIT DROP AS
	SELECT
		md5(w.id || ':workout-exercise:' || (ex.ordinality - 1)::text) AS event_id,
		w.id AS workout_id,
		w.user_id,
		w.start_time,
		(ex.ordinality - 1)::int AS exercise_order,
		ex.value ->> 'id' AS exercise_id,
		ex.value ->> 'lot' AS exercise_kind,
		ex.value -> 'sets' AS source_sets,
		legacy_exercise.id AS legacy_exercise_id,
		legacy_exercise.created_by_user_id AS exercise_owner,
		COALESCE(targets.identities, '[]'::jsonb) AS targets,
		COALESCE(equipment.identities, '[]'::jsonb) AS equipment,
		targets.expected_count AS expected_targets,
		CASE WHEN legacy_exercise.equipment IS NULL THEN 0 ELSE 1 END AS expected_equipment
	FROM "workout" w
	CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.information -> 'exercises', '[]'::jsonb))
		WITH ORDINALITY AS ex(value, ordinality)
	LEFT JOIN "exercise" legacy_exercise ON legacy_exercise.id = ex.value ->> 'id'
	LEFT JOIN LATERAL (
		SELECT count(DISTINCT muscle.external_id) AS expected_count,
			jsonb_agg(jsonb_build_object('entityId', taxonomy.id, 'role', NULL) ORDER BY taxonomy.id)
				FILTER (WHERE taxonomy.id IS NOT NULL) AS identities
		FROM (SELECT DISTINCT unnest(legacy_exercise.muscles)::text AS external_id) muscle
		LEFT JOIN "entity" taxonomy ON taxonomy.external_id = muscle.external_id
			AND taxonomy.entity_schema_slug = ${quoteSqlString(input.targetEntitySchema.slug)}
			AND taxonomy.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(input.targetEntitySchema.pluginId)}
			AND taxonomy.provider_id = ${quoteSqlString(input.targetProviderId)}
			AND taxonomy.user_id IS NULL
	) targets ON true
	LEFT JOIN LATERAL (
		SELECT jsonb_agg(taxonomy.id ORDER BY taxonomy.id) AS identities
		FROM "entity" taxonomy
		WHERE taxonomy.external_id = ${legacyEquipmentExternalIdSql("legacy_exercise.equipment")}
			AND taxonomy.entity_schema_slug = ${quoteSqlString(input.equipmentEntitySchema.slug)}
			AND taxonomy.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(input.equipmentEntitySchema.pluginId)}
			AND taxonomy.provider_id = ${quoteSqlString(input.equipmentProviderId)}
			AND taxonomy.user_id IS NULL
	) equipment ON true;

	CREATE UNIQUE INDEX ON _legacy_workout_occurrences (workout_id, exercise_order);
	CREATE UNIQUE INDEX ON _legacy_workout_occurrences (event_id);
	ANALYZE _legacy_workout_occurrences;

	${buildAbortOnRowsSql({
		countVariable: "invalid_rows",
		sampleVariable: "invalid_sample",
		message:
			"workout exercises -> taxonomy events: % recorded occurrence(s) have missing or conflicting workout/exercise identity, ownership, kind, malformed or empty set inventory, or start time: %. Each occurrence requires at least one recorded set. Keep the dump and report the identified records; correct the V1 evidence and restore a fresh copy before retrying. Do not invent sets or silently skip positions.",
		source: `SELECT source.workout_id || ':' || source.exercise_order::text AS label
			FROM _legacy_workout_occurrences source
			LEFT JOIN "entity" workout ON workout.id = source.workout_id
			LEFT JOIN "entity" exercise ON exercise.id = source.exercise_id
			WHERE source.legacy_exercise_id IS NULL
				OR source.start_time IS NULL OR NOT isfinite(source.start_time)
				OR source.exercise_kind IS NULL
				OR source.exercise_kind NOT IN (${exerciseKinds.map(quoteSqlString).join(", ")})
				OR CASE WHEN jsonb_typeof(source.source_sets) = 'array'
					THEN jsonb_array_length(source.source_sets) = 0 ELSE true END
				OR workout.id IS NULL OR workout.user_id IS DISTINCT FROM source.user_id
				OR workout.entity_schema_slug IS DISTINCT FROM ${quoteSqlString(input.workoutEntitySchema.slug)}
				OR workout.entity_schema_plugin_id IS DISTINCT FROM ${quoteNullableSqlString(input.workoutEntitySchema.pluginId)}
				OR exercise.id IS NULL
				OR exercise.entity_schema_slug IS DISTINCT FROM ${quoteSqlString(input.exerciseEntitySchema.slug)}
				OR exercise.entity_schema_plugin_id IS DISTINCT FROM ${quoteNullableSqlString(input.exerciseEntitySchema.pluginId)}
				OR exercise.user_id IS DISTINCT FROM source.exercise_owner
				OR (exercise.user_id IS NOT NULL AND exercise.user_id <> source.user_id)`,
	})}

	${buildAbortOnRowsSql({
		countVariable: "invalid_rows",
		sampleVariable: "invalid_sample",
		message:
			"workout exercises -> taxonomy events: % recorded occurrence(s) have unresolved, ambiguous, or excessive legacy taxonomy assignments: %. The migration must retain every assignment within the canonical bounds. Keep the dump and report this mapping blocker; do not truncate the source taxonomy.",
		source: `SELECT workout_id || ':' || exercise_order::text AS label
			FROM _legacy_workout_occurrences
			WHERE jsonb_array_length(targets) <> expected_targets
				OR jsonb_array_length(equipment) <> expected_equipment
				OR jsonb_array_length(targets) > ${WORKOUT_TAXONOMY_LIMIT}
				OR jsonb_array_length(equipment) > ${WORKOUT_TAXONOMY_LIMIT}`,
	})}

	INSERT INTO "event" (
		"id", "user_id", "entity_id", "session_entity_id", "event_schema_slug",
		"event_schema_plugin_id", "properties", "created_at", "occurred_at"
	)
	SELECT event_id, user_id, exercise_id, workout_id,
		${quoteSqlString(input.occurrenceEventSchema.slug)},
		${quoteNullableSqlString(input.occurrenceEventSchema.pluginId)},
		jsonb_build_object(
			'exerciseOrder', exercise_order, 'exerciseKind', exercise_kind,
			'targets', targets, 'equipment', equipment
		), start_time, start_time
	FROM _legacy_workout_occurrences;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	${buildAbortOnRowsSql({
		countVariable: "invalid_rows",
		sampleVariable: "invalid_sample",
		message:
			"workout exercises -> taxonomy events: % source set(s) do not join their recorded exercise occurrence by plugin, owner, workout, exercise, order, and kind: %. The phase has been rolled back. Keep the dump and report this migration defect; no live taxonomy fallback is safe.",
		source: `SELECT source.workout_id || ':' || source.exercise_order::text || ':' || (sets.ordinality - 1)::text AS label
			FROM _legacy_workout_occurrences source
			CROSS JOIN LATERAL jsonb_array_elements(source.source_sets) WITH ORDINALITY sets(value, ordinality)
			LEFT JOIN "event" event ON event.id = ${legacyWorkoutSetEventIdSql("source.workout_id", "source.exercise_order::text", "(sets.ordinality - 1)::text")}
			WHERE event.id IS NULL OR event.user_id IS DISTINCT FROM source.user_id
				OR event.entity_id IS DISTINCT FROM source.exercise_id
				OR event.session_entity_id IS DISTINCT FROM source.workout_id
				OR event.event_schema_slug IS DISTINCT FROM ${quoteSqlString(input.setEventSchema.slug)}
				OR event.event_schema_plugin_id IS DISTINCT FROM ${quoteNullableSqlString(input.setEventSchema.pluginId)}
				OR event.properties -> 'exerciseOrder' IS DISTINCT FROM to_jsonb(source.exercise_order)
				OR event.properties ->> 'exerciseKind' IS DISTINCT FROM source.exercise_kind`,
	})}

	SELECT count(*) INTO source_rows FROM _legacy_workout_occurrences;
	${buildReportSql("workout exercises -> taxonomy events", [
		{
			count: "source_rows",
			message: "recorded exercise positions verified against legacy assignments",
		},
		{ count: "rows_inserted", message: "legacy taxonomy occurrence events copied" },
	])}
END $$;
`;
