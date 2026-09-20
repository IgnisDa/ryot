import type { QualifiedSchema } from "./migration-resolution";
import {
	buildAbortOnRowsSql,
	buildRequireLegacyTableSql,
	buildReportSql,
	quoteNullableSqlString,
	quoteSqlString,
} from "./shared";

export const buildUserToEntityInLibraryMigrationSql = (input: {
	inLibraryRelationshipSchema: QualifiedSchema;
	libraryEntitySchema: QualifiedSchema;
	libraryEligibleEntitySchemaSlugs: ReadonlyArray<string>;
}) => {
	const phase = `user_to_entity -> ${input.inLibraryRelationshipSchema.slug} relationship`;
	const fitness = input.inLibraryRelationshipSchema.slug === "in-fitness-library";
	const properties = fitness
		? `jsonb_strip_nulls(jsonb_build_object(
			'normalRestTime', ute.exercise_extra_information #> '{settings,set_rest_timers,normal}',
			'warmUpRestTime', ute.exercise_extra_information #> '{settings,set_rest_timers,warmup}',
			'dropRestTime', ute.exercise_extra_information #> '{settings,set_rest_timers,drop}',
			'failureRestTime', ute.exercise_extra_information #> '{settings,set_rest_timers,failure}',
			'defaultDurationUnit', ute.exercise_extra_information #> '{settings,default_duration_unit}'
		))`
		: "'{}'::jsonb";
	return `
DO $$
DECLARE
	batch_size          constant int := 10000;
	batch_rows_inserted int;
	cursor_id           text         := '';
	next_cursor_id      text;
	rows_inserted       int          := 0;
	invalid_settings_count int;
	invalid_settings_sample text;
	started_at          timestamptz  := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql(phase, "user_to_entity")}
	${
		fitness
			? buildAbortOnRowsSql({
					countVariable: "invalid_settings_count",
					sampleVariable: "invalid_settings_sample",
					message:
						"user_to_entity -> in-fitness-library: % exercise preference record(s) have invalid rest settings or duration units: %. Rest overrides must be nonnegative whole seconds and duration units must be seconds or minutes. Correct those exercise settings in the V1 database, then start again.",
					source: `SELECT ute.id::text AS label FROM "user_to_entity" ute
			WHERE ute.exercise_id IS NOT NULL AND (
				(ute.exercise_extra_information #> '{settings}' IS NOT NULL
					AND jsonb_typeof(ute.exercise_extra_information #> '{settings}') NOT IN ('object', 'null'))
				OR (ute.exercise_extra_information #> '{settings,set_rest_timers}' IS NOT NULL
					AND jsonb_typeof(ute.exercise_extra_information #> '{settings,set_rest_timers}') NOT IN ('object', 'null'))
				OR (ute.exercise_extra_information #> '{settings,default_duration_unit}' IS NOT NULL
					AND ute.exercise_extra_information #> '{settings,default_duration_unit}' <> 'null'::jsonb
					AND ute.exercise_extra_information #>> '{settings,default_duration_unit}' NOT IN ('seconds', 'minutes'))
				OR EXISTS (
					SELECT 1 FROM (VALUES ('normal'), ('warmup'), ('drop'), ('failure')) rest_kind(name)
					CROSS JOIN LATERAL (SELECT ute.exercise_extra_information #> ARRAY['settings', 'set_rest_timers', rest_kind.name] AS value) rest_value
					WHERE rest_value.value IS NOT NULL AND rest_value.value <> 'null'::jsonb
						AND NOT CASE WHEN jsonb_typeof(rest_value.value) = 'number'
							THEN rest_value.value::text::numeric >= 0 AND rest_value.value::text::numeric = trunc(rest_value.value::text::numeric)
							ELSE false END
				)
			)`,
				})
			: ""
	}

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
			md5(ute.entity_id || ${quoteSqlString(`:${input.inLibraryRelationshipSchema.slug}:`)} || ute.user_id),
			ute.user_id,
			ute.entity_id,
			lib.id,
			${quoteSqlString(input.inLibraryRelationshipSchema.slug)},
			${quoteNullableSqlString(input.inLibraryRelationshipSchema.pluginId)},
			${properties},
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

	${buildReportSql(phase, [{ count: "rows_inserted", message: "row(s) migrated total" }])}
END $$;
`;
};
