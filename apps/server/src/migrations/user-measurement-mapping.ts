// V1 user_measurement (composite PK user_id+timestamp) -> V2 `measurement-metric` entities and
// `measurement-reading` events. A metric is one (user, normalized statistic key); its id is
// md5(user_id || '|measurement-metric|' || key). A reading is one statistic of one V1 row; its id
// is md5(user_id || '|' || timestamp::text || '|' || key). statistics[].value is a rust_decimal
// JSON string (extracted via ->> then ::float8). Units come from the V1 user preferences
// (fitness.measurements.statistics), which only "old_user" still carries.

import type { QualifiedSchema } from "./migration-resolution";
import {
	buildAbortOnRowsSql,
	buildReportSql,
	buildRequireLegacyTableSql,
	quoteNullableSqlString,
	quoteSqlString,
} from "./shared";

const statisticKeySql = (name: string) =>
	`trim('_' from regexp_replace(lower(${name}), '[^a-z0-9]+', '_', 'g'))`;

const legacyStatisticsSql = `
	SELECT
		um.user_id,
		um.timestamp,
		stat.ordinality,
		stat.value ->> 'name' AS name,
		${statisticKeySql("stat.value ->> 'name'")} AS key,
		stat.value ->> 'value' AS value
	FROM "user_measurement" um
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(um.information -> 'statistics') = 'array'
			THEN um.information -> 'statistics' ELSE '[]'::jsonb END
	) WITH ORDINALITY AS stat(value, ordinality)
	WHERE stat.value ->> 'name' IS NOT NULL
`;

const legacyUnitsSql = `
	SELECT
		legacy_user.id AS user_id,
		${statisticKeySql("preference.value ->> 'name'")} AS key,
		NULLIF(preference.value ->> 'unit', '') AS unit
	FROM "old_user" legacy_user
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(legacy_user.preferences #> '{fitness,measurements,statistics}') = 'array'
			THEN legacy_user.preferences #> '{fitness,measurements,statistics}' ELSE '[]'::jsonb END
	) AS preference(value)
	WHERE preference.value ->> 'name' IS NOT NULL
`;

export const buildMeasurementMigrationSql = (input: {
	readingEventSchema: QualifiedSchema;
	metricEntitySchema: QualifiedSchema;
}) => `
DO $$
DECLARE
	batch_size        constant int := 5000;
	cursor_user_id    text        := '';
	cursor_ts         timestamptz := '-infinity'::timestamptz;
	next_cursor_user_id text;
	next_cursor_ts    timestamptz;
	batch_rows_inserted int;
	metrics_inserted  int         := 0;
	readings_inserted int         := 0;
	rows_without_statistics int;
	unnamed_count     int;
	unnamed_sample    text;
	duplicate_count   int;
	duplicate_sample  text;
	conflict_count    int;
	conflict_sample   text;
	started_at        timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("user_measurement -> measurement", "user_measurement")}
	${buildRequireLegacyTableSql("user_measurement -> measurement", "old_user")}
	${buildAbortOnRowsSql({
		countVariable: "unnamed_count",
		sampleVariable: "unnamed_sample",
		source: `
			SELECT statistic.user_id || ':' || statistic.timestamp::text || ':' || (statistic.ordinality - 1)::text AS label
			FROM (${legacyStatisticsSql}) statistic
			WHERE statistic.key = ''
		`,
		message:
			"user_measurement -> measurement: % statistic(s) have a name with no letters or digits: %. A measurement metric is keyed by its normalized name, so these cannot be migrated without inventing a key. Rename or delete those statistics in the V1 database, then start the server again.",
	})}
	${buildAbortOnRowsSql({
		countVariable: "duplicate_count",
		sampleVariable: "duplicate_sample",
		source: `
			SELECT statistic.user_id || ':' || statistic.timestamp::text || ':' || statistic.key AS label
			FROM (${legacyStatisticsSql}) statistic
			GROUP BY statistic.user_id, statistic.timestamp, statistic.key
			HAVING count(*) > 1
		`,
		message:
			"user_measurement -> measurement: % measurement row(s) have two statistics whose names normalize to the same key: %. Each reading is identified by its row and key, so one of the values would be lost. Rename or delete the duplicate statistics in the V1 database, then start the server again.",
	})}
	${buildAbortOnRowsSql({
		countVariable: "conflict_count",
		sampleVariable: "conflict_sample",
		message:
			"user_measurement -> measurement: % (user, statistic) pair(s) have more than one distinct unit in the V1 measurement preferences: %. A measurement metric has a single unit, so none can be chosen without changing the recorded data. Make each user's preference units consistent in the V1 database, then start the server again.",
		source: `
			SELECT unit.user_id || ':' || unit.key AS label
			FROM (${legacyUnitsSql}) unit
			WHERE unit.unit IS NOT NULL
				AND EXISTS (
					SELECT 1 FROM (${legacyStatisticsSql}) statistic
					WHERE statistic.user_id = unit.user_id AND statistic.key = unit.key
				)
			GROUP BY unit.user_id, unit.key
			HAVING count(DISTINCT unit.unit) > 1
		`,
	})}

	INSERT INTO "entity" (
		"id",
		"user_id",
		"entity_schema_slug",
		"entity_schema_plugin_id",
		"name",
		"properties",
		"created_at",
		"updated_at"
	)
	SELECT
		md5(first_seen.user_id || '|measurement-metric|' || first_seen.key),
		first_seen.user_id,
		${quoteSqlString(input.metricEntitySchema.slug)},
		${quoteNullableSqlString(input.metricEntitySchema.pluginId)},
		initcap(replace(first_seen.name, '_', ' ')),
		jsonb_build_object('key', first_seen.key)
			|| CASE WHEN unit.unit IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('unit', unit.unit) END,
		first_seen.timestamp,
		first_seen.timestamp
	FROM (
		SELECT DISTINCT ON (statistic.user_id, statistic.key)
			statistic.user_id, statistic.key, statistic.name, statistic.timestamp
		FROM (${legacyStatisticsSql}) statistic
		ORDER BY statistic.user_id, statistic.key, statistic.timestamp, statistic.ordinality
	) first_seen
	LEFT JOIN (
		SELECT preference.user_id, preference.key, min(preference.unit) AS unit
		FROM (${legacyUnitsSql}) preference
		GROUP BY preference.user_id, preference.key
	) unit ON unit.user_id = first_seen.user_id AND unit.key = first_seen.key
	ON CONFLICT ("id") DO NOTHING;
	GET DIAGNOSTICS metrics_inserted = ROW_COUNT;

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

		INSERT INTO "event" (
			"id",
			"user_id",
			"entity_id",
			"event_schema_slug",
			"event_schema_plugin_id",
			"properties",
			"created_at",
			"occurred_at"
		)
		SELECT
			md5(um.user_id || '|' || um.timestamp::text || '|' || ${statisticKeySql("stat.value ->> 'name'")}),
			um.user_id,
			md5(um.user_id || '|measurement-metric|' || ${statisticKeySql("stat.value ->> 'name'")}),
			${quoteSqlString(input.readingEventSchema.slug)},
			${quoteNullableSqlString(input.readingEventSchema.pluginId)},
			jsonb_build_object('value', (stat.value ->> 'value')::float8)
				|| CASE WHEN NULLIF(um.comment, '') IS NULL THEN '{}'::jsonb
					ELSE jsonb_build_object('comment', um.comment) END,
			um.timestamp,
			um.timestamp
		FROM "user_measurement" um
		CROSS JOIN LATERAL jsonb_array_elements(
			CASE WHEN jsonb_typeof(um.information -> 'statistics') = 'array'
				THEN um.information -> 'statistics' ELSE '[]'::jsonb END
		) AS stat(value)
		WHERE (um.user_id, um.timestamp) > (cursor_user_id, cursor_ts)
		  AND (um.user_id, um.timestamp) <= (next_cursor_user_id, next_cursor_ts)
		  AND stat.value ->> 'name' IS NOT NULL
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		readings_inserted := readings_inserted + batch_rows_inserted;
		cursor_user_id    := next_cursor_user_id;
		cursor_ts         := next_cursor_ts;
	END LOOP;

	SELECT count(*) INTO rows_without_statistics
	FROM "user_measurement" um
	WHERE NOT EXISTS (
		SELECT 1
		FROM jsonb_array_elements(
			CASE WHEN jsonb_typeof(um.information -> 'statistics') = 'array'
				THEN um.information -> 'statistics' ELSE '[]'::jsonb END
		) AS stat(value)
		WHERE stat.value ->> 'name' IS NOT NULL
	);

	${buildReportSql("user_measurement -> measurement-metric", [{ count: "metrics_inserted", message: "metric(s) migrated total" }])}
	${buildReportSql("user_measurement -> measurement-reading", [
		{ count: "readings_inserted", message: "reading(s) migrated total" },
		{
			count: "rows_without_statistics",
			message: "row(s) with no named statistic omitted (nothing to record)",
		},
	])}
END $$;
`;
