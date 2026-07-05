// Backfills whole-entity `complete` events for episodic media: walks the 100%-progress events per
// user/parent entity chronologically and emits a `complete` event each time every required coverage
// key (episode/chapter) has been seen, then resets coverage for the next watch-through.
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
			show_entity.id AS entity_id,
			'complete' AS complete_event_schema_slug,
			episode.id AS coverage_key
		FROM "entity" show_entity
		INNER JOIN "relationship" show_season_rel
			ON  show_season_rel.source_entity_id = show_entity.id
			AND show_season_rel.relationship_schema_slug = 'show-to-show-season'
		INNER JOIN "entity" season
			ON  season.id = show_season_rel.target_entity_id
			AND season.entity_schema_slug = 'show-season'
		INNER JOIN "relationship" season_episode_rel
			ON  season_episode_rel.source_entity_id = season.id
			AND season_episode_rel.relationship_schema_slug = 'show-season-to-show-episode'
		INNER JOIN "entity" episode
			ON  episode.id = season_episode_rel.target_entity_id
			AND episode.entity_schema_slug = 'show-episode'
		WHERE show_entity.entity_schema_slug = 'show'
		  AND (show_season_rel.user_id IS NULL OR show_season_rel.user_id = show_entity.user_id)
		  AND (season_episode_rel.user_id IS NULL OR season_episode_rel.user_id = show_entity.user_id)
		  AND (season.user_id IS NULL OR season.user_id = show_entity.user_id)
		  AND (episode.user_id IS NULL OR episode.user_id = show_entity.user_id)
		  AND (season.properties ->> 'seasonNumber') ~ '^[0-9]+$'
		  AND (episode.properties ->> 'episodeNumber') ~ '^[0-9]+$'
		  AND (season.properties ->> 'seasonNumber')::int > 0
		  AND season.name NOT IN ('Specials', 'Extras')
		  AND (episode.properties ->> 'episodeNumber')::int > 0
	), anime_keys AS (
		SELECT
			e.id AS entity_id,
			'complete' AS complete_event_schema_slug,
			gs::text AS coverage_key
		FROM "entity" e
		CROSS JOIN LATERAL generate_series(1, (e.properties ->> 'episodes')::int) AS gs
		WHERE e.entity_schema_slug = 'anime'
		  AND (e.properties ->> 'episodes') ~ '^[0-9]+$'
		  AND (e.properties ->> 'episodes')::int > 0
	), manga_counts AS (
		SELECT
			e.id AS entity_id,
			'complete' AS complete_event_schema_slug,
			(e.properties ->> 'chapters')::numeric AS chapter_count
		FROM "entity" e
		WHERE e.entity_schema_slug = 'manga'
		  AND (e.properties ->> 'chapters') ~ '^[0-9]+(\\.[0-9]+)?$'
		  AND (e.properties ->> 'chapters')::numeric > 0
	), manga_keys AS (
		SELECT
			entity_id,
			complete_event_schema_slug,
			gs::text AS coverage_key
		FROM manga_counts
		CROSS JOIN LATERAL generate_series(1, floor(chapter_count)::int) AS gs
		UNION ALL
		SELECT
			entity_id,
			complete_event_schema_slug,
			(chapter_count::float8)::text AS coverage_key
		FROM manga_counts
		WHERE chapter_count <> floor(chapter_count)
	), podcast_keys AS (
		SELECT DISTINCT
			podcast.id AS entity_id,
			'complete' AS complete_event_schema_slug,
			episode.id AS coverage_key
		FROM "entity" podcast
		INNER JOIN "relationship" podcast_episode_rel
			ON  podcast_episode_rel.source_entity_id = podcast.id
			AND podcast_episode_rel.relationship_schema_slug = 'podcast-to-podcast-episode'
		INNER JOIN "entity" episode
			ON  episode.id = podcast_episode_rel.target_entity_id
			AND episode.entity_schema_slug = 'podcast-episode'
		WHERE podcast.entity_schema_slug = 'podcast'
		  AND (podcast_episode_rel.user_id IS NULL OR podcast_episode_rel.user_id = podcast.user_id)
		  AND (episode.user_id IS NULL OR episode.user_id = podcast.user_id)
		  AND (episode.properties ->> 'episodeNumber') ~ '^[0-9]+$'
		  AND (episode.properties ->> 'episodeNumber')::int > 0
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
		complete_event_schema_slug,
		count(*)::int AS required_count
	FROM _seen_required_coverage
	GROUP BY entity_id, complete_event_schema_slug;

	CREATE UNIQUE INDEX ON _seen_required_counts (entity_id);

	CREATE TEMP TABLE _seen_progress_coverage ON COMMIT DROP AS
	WITH progress AS (
		SELECT
			ev.id AS event_id,
			ev.user_id,
			show_entity.id AS entity_id,
			ev.created_at,
			NULLIF(ev.properties ->> 'consumedOn', '') AS consumed_on,
			ev.entity_id AS coverage_key
		FROM "event" ev
		INNER JOIN "entity" episode
			ON  episode.id = ev.entity_id
			AND episode.entity_schema_slug = 'show-episode'
		INNER JOIN "relationship" season_episode_rel
			ON  season_episode_rel.target_entity_id = episode.id
			AND season_episode_rel.relationship_schema_slug = 'show-season-to-show-episode'
		INNER JOIN "entity" season
			ON  season.id = season_episode_rel.source_entity_id
			AND season.entity_schema_slug = 'show-season'
		INNER JOIN "relationship" show_season_rel
			ON  show_season_rel.target_entity_id = season.id
			AND show_season_rel.relationship_schema_slug = 'show-to-show-season'
		INNER JOIN "entity" show_entity
			ON  show_entity.id = show_season_rel.source_entity_id
			AND show_entity.entity_schema_slug = 'show'
		WHERE ev.event_schema_slug = 'progress'
		  AND (ev.properties ->> 'progressPercent')::numeric = 100
		  AND (show_season_rel.user_id = ev.user_id OR show_season_rel.user_id IS NULL)
		  AND (season_episode_rel.user_id = ev.user_id OR season_episode_rel.user_id IS NULL)
		  AND (show_entity.user_id = ev.user_id OR show_entity.user_id IS NULL)
		  AND (season.user_id = ev.user_id OR season.user_id IS NULL)
		  AND (episode.user_id = ev.user_id OR episode.user_id IS NULL)
		UNION ALL
		SELECT
			ev.id AS event_id,
			ev.user_id,
			podcast.id AS entity_id,
			ev.created_at,
			NULLIF(ev.properties ->> 'consumedOn', '') AS consumed_on,
			ev.entity_id AS coverage_key
		FROM "event" ev
		INNER JOIN "entity" episode
			ON  episode.id = ev.entity_id
			AND episode.entity_schema_slug = 'podcast-episode'
		INNER JOIN "relationship" podcast_episode_rel
			ON  podcast_episode_rel.target_entity_id = episode.id
			AND podcast_episode_rel.relationship_schema_slug = 'podcast-to-podcast-episode'
		INNER JOIN "entity" podcast
			ON  podcast.id = podcast_episode_rel.source_entity_id
			AND podcast.entity_schema_slug = 'podcast'
		WHERE ev.event_schema_slug = 'progress'
		  AND (ev.properties ->> 'progressPercent')::numeric = 100
		  AND (podcast_episode_rel.user_id = ev.user_id OR podcast_episode_rel.user_id IS NULL)
		  AND (podcast.user_id = ev.user_id OR podcast.user_id IS NULL)
		  AND (episode.user_id = ev.user_id OR episode.user_id IS NULL)
		UNION ALL
		SELECT
			ev.id AS event_id,
			ev.user_id,
			ev.entity_id,
			ev.created_at,
			NULLIF(ev.properties ->> 'consumedOn', '') AS consumed_on,
			CASE e.entity_schema_slug
				WHEN 'anime' THEN
					CASE WHEN (ev.properties ->> 'animeEpisode') ~ '^[0-9]+$'
					THEN ev.properties ->> 'animeEpisode'
					END
				WHEN 'manga' THEN
					CASE WHEN (ev.properties ->> 'mangaChapter') ~ '^[0-9]+(\\.[0-9]+)?$'
					THEN ((ev.properties ->> 'mangaChapter')::float8)::text
					END
			END AS coverage_key
		FROM "event" ev
		INNER JOIN "entity" e ON e.id = ev.entity_id
		WHERE ev.event_schema_slug = 'progress'
		  AND e.entity_schema_slug IN ('anime', 'manga')
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
			required_counts.complete_event_schema_slug,
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
					"event_schema_slug",
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
					entity_rec.complete_event_schema_slug,
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
