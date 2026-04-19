// Backfill whole-entity `complete` events for episodic seen migrations.
//
// V1 episodic `Completed` seen rows are migrated as V2 progress(100%) events with episode/chapter
// keys. This pass walks those progress events chronologically per user/entity, emits a `complete`
// event once all required coverage keys are present, then resets coverage so another full coverage
// cycle produces another `complete` event.

export const buildSeenEpisodicCompletionMigrationSql = () => `
DO $$
DECLARE
	entity_rec        record;
	progress_rec      record;
	covered_keys      text[];
	batch_count       int;
	complete_inserted int := 0;
	started_at        timestamptz := clock_timestamp();
BEGIN
	RAISE NOTICE 'seen -> event: episodic completion backfill started (% seconds elapsed)', 0.0;

	CREATE TEMP TABLE _seen_required_coverage ON COMMIT DROP AS
	WITH show_keys AS (
		SELECT DISTINCT
			e.id AS entity_id,
			complete_schema.id AS complete_event_schema_id,
			keyed.season_number::text || '-' || keyed.episode_number::text AS coverage_key
		FROM "entity" e
		INNER JOIN "entity_schema" entity_schema
			ON  entity_schema.id   = e.entity_schema_id
			AND entity_schema.slug = 'show'
		INNER JOIN "event_schema" complete_schema
			ON  complete_schema.entity_schema_id = e.entity_schema_id
			AND complete_schema.slug             = 'complete'
			AND complete_schema.user_id          IS NULL
		CROSS JOIN LATERAL jsonb_array_elements(
			CASE
				WHEN jsonb_typeof(e.properties -> 'showSeasons') = 'array'
				THEN e.properties -> 'showSeasons'
				ELSE '[]'::jsonb
			END
		) AS season(value)
		CROSS JOIN LATERAL jsonb_array_elements(
			CASE
				WHEN jsonb_typeof(season.value -> 'episodes') = 'array'
				THEN season.value -> 'episodes'
				ELSE '[]'::jsonb
			END
		) AS episode(value)
		CROSS JOIN LATERAL (
			SELECT
				(season.value ->> 'seasonNumber')::int AS season_number,
				(episode.value ->> 'episodeNumber')::int AS episode_number
		) keyed
		WHERE COALESCE(season.value ->> 'name', '') NOT IN ('Specials', 'Extras')
		  AND (season.value ->> 'seasonNumber') ~ '^[0-9]+$'
		  AND (episode.value ->> 'episodeNumber') ~ '^[0-9]+$'
		  AND keyed.season_number > 0
		  AND keyed.episode_number > 0
	), anime_keys AS (
		SELECT
			e.id AS entity_id,
			complete_schema.id AS complete_event_schema_id,
			gs::text AS coverage_key
		FROM "entity" e
		INNER JOIN "entity_schema" entity_schema
			ON  entity_schema.id   = e.entity_schema_id
			AND entity_schema.slug = 'anime'
		INNER JOIN "event_schema" complete_schema
			ON  complete_schema.entity_schema_id = e.entity_schema_id
			AND complete_schema.slug             = 'complete'
			AND complete_schema.user_id          IS NULL
		CROSS JOIN LATERAL generate_series(1, (e.properties ->> 'episodes')::int) AS gs
		WHERE (e.properties ->> 'episodes') ~ '^[0-9]+$'
		  AND (e.properties ->> 'episodes')::int > 0
	), manga_counts AS (
		SELECT
			e.id AS entity_id,
			complete_schema.id AS complete_event_schema_id,
			(e.properties ->> 'chapters')::numeric AS chapter_count
		FROM "entity" e
		INNER JOIN "entity_schema" entity_schema
			ON  entity_schema.id   = e.entity_schema_id
			AND entity_schema.slug = 'manga'
		INNER JOIN "event_schema" complete_schema
			ON  complete_schema.entity_schema_id = e.entity_schema_id
			AND complete_schema.slug             = 'complete'
			AND complete_schema.user_id          IS NULL
		WHERE (e.properties ->> 'chapters') ~ '^[0-9]+(\\.[0-9]+)?$'
		  AND (e.properties ->> 'chapters')::numeric > 0
	), manga_keys AS (
		SELECT
			entity_id,
			complete_event_schema_id,
			gs::text AS coverage_key
		FROM manga_counts
		CROSS JOIN LATERAL generate_series(1, floor(chapter_count)::int) AS gs
		UNION ALL
		SELECT
			entity_id,
			complete_event_schema_id,
			(chapter_count::float8)::text AS coverage_key
		FROM manga_counts
		WHERE chapter_count <> floor(chapter_count)
	), podcast_keys AS (
		SELECT DISTINCT
			e.id AS entity_id,
			complete_schema.id AS complete_event_schema_id,
			(episode.value ->> 'number')::int::text AS coverage_key
		FROM "entity" e
		INNER JOIN "entity_schema" entity_schema
			ON  entity_schema.id   = e.entity_schema_id
			AND entity_schema.slug = 'podcast'
		INNER JOIN "event_schema" complete_schema
			ON  complete_schema.entity_schema_id = e.entity_schema_id
			AND complete_schema.slug             = 'complete'
			AND complete_schema.user_id          IS NULL
		CROSS JOIN LATERAL jsonb_array_elements(
			CASE
				WHEN jsonb_typeof(e.properties -> 'episodes') = 'array'
				THEN e.properties -> 'episodes'
				ELSE '[]'::jsonb
			END
		) AS episode(value)
		WHERE (episode.value ->> 'number') ~ '^[0-9]+$'
		  AND (episode.value ->> 'number')::int > 0
	)
	SELECT * FROM show_keys
	UNION ALL
	SELECT * FROM anime_keys
	UNION ALL
	SELECT * FROM manga_keys
	UNION ALL
	SELECT * FROM podcast_keys;

	CREATE INDEX ON _seen_required_coverage (entity_id, coverage_key);

	CREATE TEMP TABLE _seen_required_counts ON COMMIT DROP AS
	SELECT
		entity_id,
		complete_event_schema_id,
		count(*)::int AS required_count
	FROM _seen_required_coverage
	GROUP BY entity_id, complete_event_schema_id;

	CREATE UNIQUE INDEX ON _seen_required_counts (entity_id);

	CREATE TEMP TABLE _seen_progress_coverage ON COMMIT DROP AS
	WITH progress AS (
		SELECT
			ev.id AS event_id,
			ev.user_id,
			ev.entity_id,
			ev.created_at,
			NULLIF(ev.properties ->> 'consumedOn', '') AS consumed_on,
			CASE entity_schema.slug
				WHEN 'show' THEN
					CASE WHEN (ev.properties ->> 'showSeason') ~ '^[0-9]+$'
						AND (ev.properties ->> 'showEpisode') ~ '^[0-9]+$'
					THEN (ev.properties ->> 'showSeason') || '-' || (ev.properties ->> 'showEpisode')
					END
				WHEN 'anime' THEN
					CASE WHEN (ev.properties ->> 'animeEpisode') ~ '^[0-9]+$'
					THEN ev.properties ->> 'animeEpisode'
					END
				WHEN 'manga' THEN
					CASE WHEN (ev.properties ->> 'mangaChapter') ~ '^[0-9]+(\\.[0-9]+)?$'
					THEN ((ev.properties ->> 'mangaChapter')::float8)::text
					END
				WHEN 'podcast' THEN
					CASE WHEN (ev.properties ->> 'podcastEpisode') ~ '^[0-9]+$'
					THEN ev.properties ->> 'podcastEpisode'
					END
			END AS coverage_key
		FROM "event" ev
		INNER JOIN "event_schema" progress_schema
			ON  progress_schema.id      = ev.event_schema_id
			AND progress_schema.slug    = 'progress'
			AND progress_schema.user_id IS NULL
		INNER JOIN "entity" e ON e.id = ev.entity_id
		INNER JOIN "entity_schema" entity_schema ON entity_schema.id = e.entity_schema_id
		WHERE entity_schema.slug IN ('show', 'anime', 'manga', 'podcast')
		  AND (ev.properties ->> 'progressPercent')::numeric = 100
	)
	SELECT progress.*
	FROM progress
	INNER JOIN _seen_required_coverage required
		ON  required.entity_id    = progress.entity_id
		AND required.coverage_key = progress.coverage_key;

	CREATE INDEX ON _seen_progress_coverage (user_id, entity_id, created_at, event_id);
	CREATE INDEX ON _seen_progress_coverage (entity_id, coverage_key);
	ANALYZE _seen_required_coverage;
	ANALYZE _seen_required_counts;
	ANALYZE _seen_progress_coverage;

	FOR entity_rec IN
		SELECT DISTINCT
			progress.user_id,
			progress.entity_id,
			required_counts.complete_event_schema_id,
			required_counts.required_count
		FROM _seen_progress_coverage progress
		INNER JOIN _seen_required_counts required_counts
			ON required_counts.entity_id = progress.entity_id
		ORDER BY progress.user_id, progress.entity_id
	LOOP
		covered_keys := ARRAY[]::text[];

		FOR progress_rec IN
			SELECT event_id, created_at, consumed_on, coverage_key
			FROM _seen_progress_coverage
			WHERE user_id = entity_rec.user_id
			  AND entity_id = entity_rec.entity_id
			ORDER BY created_at, event_id
		LOOP
			IF NOT (progress_rec.coverage_key = ANY(covered_keys)) THEN
				covered_keys := covered_keys || progress_rec.coverage_key;
			END IF;

			IF COALESCE(array_length(covered_keys, 1), 0) = entity_rec.required_count THEN
				INSERT INTO "event" (
					"id",
					"user_id",
					"entity_id",
					"event_schema_id",
					"properties",
					"created_at",
					"occurred_at"
				)
				VALUES (
					md5(
						entity_rec.user_id || ':' || entity_rec.entity_id
						|| ':episodic-complete:' || progress_rec.event_id
					),
					entity_rec.user_id,
					entity_rec.entity_id,
					entity_rec.complete_event_schema_id,
					jsonb_strip_nulls(jsonb_build_object(
						'completionMode', 'custom_timestamps',
						'completedOn',    to_char(
							progress_rec.created_at AT TIME ZONE 'UTC',
							'YYYY-MM-DD"T"HH24:MI:SS"Z"'
						),
						'consumedOn',     progress_rec.consumed_on
					)),
					progress_rec.created_at,
					progress_rec.created_at
				)
				ON CONFLICT DO NOTHING;
				GET DIAGNOSTICS batch_count = ROW_COUNT;
				complete_inserted := complete_inserted + batch_count;
				covered_keys := ARRAY[]::text[];
			END IF;
		END LOOP;
	END LOOP;

	RAISE NOTICE 'seen -> event: % episodic complete events backfilled (% seconds elapsed)',
		complete_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
