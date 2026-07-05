// Each V1 `seen` row expands to one or more V2 events keyed by its `updated_at` timestamp array:
// InProgress -> N progress events; episodic Completed -> N progress events (final at 100%, episode
// completion backfilled later by seen-completion-mapping); other terminal states -> N-1 progress +
// 1 terminal event. progressPercent is linearly interpolated to the target P and clamped to [1,100]:
// percent[j] = ROUND(1 + (P-1)*j/(M-1), 2) over M events (P when M=1, or 1 before a terminal event).
// Legacy ids are not preserved (one row -> many events); deterministic md5 ids give restart-safety.
// manual_time_spent (seconds) becomes timeSpent (minutes). Unresolved show/podcast episode rows and
// rows whose metadata_id has no migrated entity are skipped. Dropped: review_id, and
// manual_time_spent/started_on on progress events (V2 progress has neither).
export const buildSeenMigrationSql = () => `
DO $$
DECLARE
	batch_size     constant int := 500;
	cursor_id      text         := '';
	next_cursor_id text;
	prog_inserted  int          := 0;
	term_inserted  int          := 0;
	unresolved_episode_rows int := 0;
	batch_count    int;
	started_at     timestamptz  := clock_timestamp();
BEGIN
	IF to_regclass('"seen"') IS NULL THEN
		RAISE EXCEPTION 'Expected seen table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'seen -> event: migration started (% seconds elapsed)', 0.0;

	IF to_regclass('pg_temp._legacy_show_episode_resolution') IS NULL
		OR to_regclass('pg_temp._legacy_podcast_episode_resolution') IS NULL THEN
		IF to_regclass('pg_temp._legacy_show_episode_resolution') IS NOT NULL THEN
			DROP TABLE _legacy_show_episode_resolution;
		END IF;

		IF to_regclass('pg_temp._legacy_podcast_episode_resolution') IS NOT NULL THEN
			DROP TABLE _legacy_podcast_episode_resolution;
		END IF;

	CREATE TEMP TABLE _legacy_show_episode_resolution ON COMMIT DROP AS
	WITH candidates AS (
		SELECT DISTINCT
			show_entity.id AS parent_entity_id,
			season.properties ->> 'seasonNumber' AS season_number,
			episode.properties ->> 'episodeNumber' AS episode_number,
			episode.id AS entity_id,
			episode.entity_schema_slug
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
		  AND (show_season_rel.user_id = show_entity.user_id OR show_season_rel.user_id IS NULL)
		  AND (season_episode_rel.user_id = show_entity.user_id OR season_episode_rel.user_id IS NULL)
		  AND (season.user_id = show_entity.user_id OR season.user_id IS NULL)
		  AND (episode.user_id = show_entity.user_id OR episode.user_id IS NULL)
		  AND (season.properties ->> 'seasonNumber') ~ '^[0-9]+$'
		  AND (episode.properties ->> 'episodeNumber') ~ '^[0-9]+$'
	), unique_candidates AS (
		SELECT parent_entity_id, season_number, episode_number
		FROM candidates
		GROUP BY parent_entity_id, season_number, episode_number
		HAVING count(*) = 1
	)
	SELECT candidates.*
	FROM candidates
	INNER JOIN unique_candidates
		ON  unique_candidates.parent_entity_id = candidates.parent_entity_id
		AND unique_candidates.season_number    = candidates.season_number
		AND unique_candidates.episode_number   = candidates.episode_number;

	CREATE UNIQUE INDEX ON _legacy_show_episode_resolution (
		parent_entity_id,
		season_number,
		episode_number
	);

	CREATE TEMP TABLE _legacy_podcast_episode_resolution ON COMMIT DROP AS
	WITH candidates AS (
		SELECT DISTINCT
			podcast.id AS parent_entity_id,
			episode.properties ->> 'episodeNumber' AS episode_number,
			episode.id AS entity_id,
			episode.entity_schema_slug
		FROM "entity" podcast
		INNER JOIN "relationship" podcast_episode_rel
			ON  podcast_episode_rel.source_entity_id = podcast.id
			AND podcast_episode_rel.relationship_schema_slug = 'podcast-to-podcast-episode'
		INNER JOIN "entity" episode
			ON  episode.id = podcast_episode_rel.target_entity_id
			AND episode.entity_schema_slug = 'podcast-episode'
		WHERE podcast.entity_schema_slug = 'podcast'
		  AND (podcast_episode_rel.user_id = podcast.user_id OR podcast_episode_rel.user_id IS NULL)
		  AND (episode.user_id = podcast.user_id OR episode.user_id IS NULL)
		  AND (episode.properties ->> 'episodeNumber') ~ '^[0-9]+$'
	), unique_candidates AS (
		SELECT parent_entity_id, episode_number
		FROM candidates
		GROUP BY parent_entity_id, episode_number
		HAVING count(*) = 1
	)
	SELECT candidates.*
	FROM candidates
	INNER JOIN unique_candidates
		ON  unique_candidates.parent_entity_id = candidates.parent_entity_id
		AND unique_candidates.episode_number   = candidates.episode_number;

	CREATE UNIQUE INDEX ON _legacy_podcast_episode_resolution (
		parent_entity_id,
		episode_number
	);
	ANALYZE _legacy_show_episode_resolution;
	ANALYZE _legacy_podcast_episode_resolution;
	END IF;

	LOOP
		WITH batch AS (
			SELECT s.id AS id
			FROM "seen" s
			WHERE s.id > cursor_id
			ORDER BY s.id
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		-- Progress events: full stream for in-progress and episodic completions; otherwise before terminal.
		INSERT INTO "event" (
			"id",
			"user_id",
			"entity_id",
			"event_schema_slug",
			"properties",
			"created_at",
			"occurred_at"
		)
		WITH rows AS (
			SELECT
				s.id                                                  AS seen_id,
				s.user_id,
				s.metadata_id,
				e.entity_schema_slug,
				show_episode.entity_id                                AS show_episode_entity_id,
				podcast_episode.entity_id                             AS podcast_episode_entity_id,
				e.entity_schema_slug IN ('show', 'anime', 'manga', 'podcast') AS is_episodic,
				(s.show_extra_information ->> 'season') ~ '^[0-9]+$'
					AND (s.show_extra_information ->> 'episode') ~ '^[0-9]+$' AS has_show_episode_locator,
				(s.podcast_extra_information ->> 'episode') ~ '^[0-9]+$' AS has_podcast_episode_locator,
				GREATEST(LEAST(s.progress::numeric, 100), 1)          AS clamped_progress,
				(
					s.state = 'completed'
					OR (s.state = 'in_progress' AND s.progress >= 100)
				)                                                     AS is_completion_state,
				s.state IN ('dropped', 'on_a_hold')                   AS is_interrupting_terminal_state,
				s.providers_consumed_on,
				s.show_extra_information,
				s.anime_extra_information,
				s.manga_extra_information,
				s.podcast_extra_information,
				s.updated_at,
				array_length(s.updated_at, 1)                         AS n_ts,
				t.ts                                                  AS event_ts,
				(t.idx)::int                                          AS event_idx
			FROM "seen" s
			INNER JOIN "entity" e ON e.id = s.metadata_id
			LEFT JOIN _legacy_show_episode_resolution show_episode
				ON e.entity_schema_slug = 'show'
				AND show_episode.parent_entity_id = s.metadata_id
				AND show_episode.season_number = s.show_extra_information ->> 'season'
				AND show_episode.episode_number = s.show_extra_information ->> 'episode'
				AND (s.show_extra_information ->> 'season') ~ '^[0-9]+$'
				AND (s.show_extra_information ->> 'episode') ~ '^[0-9]+$'
			LEFT JOIN _legacy_podcast_episode_resolution podcast_episode
				ON e.entity_schema_slug = 'podcast'
				AND podcast_episode.parent_entity_id = s.metadata_id
				AND podcast_episode.episode_number = s.podcast_extra_information ->> 'episode'
				AND (s.podcast_extra_information ->> 'episode') ~ '^[0-9]+$'
			CROSS JOIN LATERAL unnest(s.updated_at) WITH ORDINALITY AS t(ts, idx)
			WHERE s.id > cursor_id
			  AND s.id <= next_cursor_id
		), classified AS (
			SELECT
				*,
				COALESCE(show_episode_entity_id, podcast_episode_entity_id, metadata_id) AS target_entity_id,
				CASE
					WHEN is_completion_state AND is_episodic THEN 100::numeric
					ELSE clamped_progress
				END AS progress_target,
				(
					is_interrupting_terminal_state
					OR (is_completion_state AND NOT is_episodic)
				) AS has_terminal_event
			FROM rows
		)
		SELECT
			md5(r.seen_id || ':p:' || (r.event_idx - 1)::text),
			r.user_id,
			r.target_entity_id,
			'progress',
			jsonb_strip_nulls(jsonb_build_object(
				'progressPercent',
					CASE
						WHEN NOT r.has_terminal_event THEN
							CASE WHEN r.n_ts = 1
							THEN r.progress_target
							ELSE ROUND(
								1 + (r.progress_target - 1) * (r.event_idx - 1)::numeric
								  / (r.n_ts - 1),
								2
							)
							END
						ELSE
							CASE WHEN r.n_ts = 2
							THEN 1
							ELSE ROUND(
								1 + (r.progress_target - 1) * (r.event_idx - 1)::numeric
								  / (r.n_ts - 2),
								2
							)
							END
					END,
				'consumedOn',    NULLIF(r.providers_consumed_on[r.event_idx], ''),
				'animeEpisode',  (r.anime_extra_information ->> 'episode')::int,
				'mangaVolume',   (r.manga_extra_information ->> 'volume')::int,
				'mangaChapter',  NULLIF(r.manga_extra_information ->> 'chapter', '')::float8
			)),
			r.event_ts,
			r.event_ts
		FROM classified r
		WHERE (NOT r.has_terminal_event OR r.event_idx < r.n_ts)
		  AND NOT (
				r.entity_schema_slug = 'show'
				AND r.has_show_episode_locator
				AND r.show_episode_entity_id IS NULL
			)
		  AND NOT (
				r.entity_schema_slug = 'podcast'
				AND r.has_podcast_episode_locator
				AND r.podcast_episode_entity_id IS NULL
			)
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_count = ROW_COUNT;
		prog_inserted := prog_inserted + batch_count;

		-- Terminal events: non-episodic complete, dropped, and on_hold.
		INSERT INTO "event" (
			"id",
			"user_id",
			"entity_id",
			"event_schema_slug",
			"properties",
			"created_at",
			"occurred_at"
		)
		WITH rows AS (
			SELECT
				s.id                                                  AS seen_id,
				s.user_id,
				s.metadata_id,
				e.entity_schema_slug,
				e.entity_schema_slug IN ('show', 'anime', 'manga', 'podcast') AS is_episodic,
				GREATEST(LEAST(s.progress::numeric, 100), 1)          AS clamped_progress,
				CASE
					WHEN s.state = 'dropped' THEN 'dropped'
					WHEN s.state = 'on_a_hold' THEN 'on_hold'
					WHEN (
						s.state = 'completed'
						OR (s.state = 'in_progress' AND s.progress >= 100)
					) AND e.entity_schema_slug NOT IN ('show', 'anime', 'manga', 'podcast') THEN 'complete'
				END AS terminal_slug,
				s.providers_consumed_on,
				s.show_extra_information,
				s.anime_extra_information,
				s.manga_extra_information,
				s.podcast_extra_information,
				s.started_on,
				s.finished_on,
				s.manual_time_spent,
				s.updated_at,
				array_length(s.updated_at, 1)                         AS n_ts
			FROM "seen" s
			INNER JOIN "entity" e ON e.id = s.metadata_id
			WHERE s.id > cursor_id
			  AND s.id <= next_cursor_id
		)
		SELECT
			md5(r.seen_id || ':t'),
			r.user_id,
			r.metadata_id,
			r.terminal_slug,
			CASE r.terminal_slug
				WHEN 'complete' THEN
					jsonb_strip_nulls(jsonb_build_object(
						'completionMode', 'custom_timestamps',
						'completedOn',    to_char(
							COALESCE(r.finished_on, r.updated_at[r.n_ts]) AT TIME ZONE 'UTC',
							'YYYY-MM-DD"T"HH24:MI:SS"Z"'
						),
						'startedOn',      CASE WHEN r.started_on IS NOT NULL THEN
							to_char(r.started_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
						END,
						'timeSpent',      r.manual_time_spent / 60.0,
						'consumedOn',     COALESCE(
							NULLIF(r.providers_consumed_on[r.n_ts], ''),
							NULLIF(r.providers_consumed_on[1], '')
						)
					))
				WHEN 'dropped' THEN
					jsonb_strip_nulls(jsonb_build_object(
						'progressPercent', r.clamped_progress,
						'consumedOn',      COALESCE(
							NULLIF(r.providers_consumed_on[r.n_ts], ''),
							NULLIF(r.providers_consumed_on[1], '')
						),
						'startedOn',       CASE WHEN r.started_on IS NOT NULL THEN
							to_char(r.started_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
						END,
						'timeSpent',       r.manual_time_spent / 60.0,
						'animeEpisode',    (r.anime_extra_information ->> 'episode')::int,
						'mangaVolume',     (r.manga_extra_information ->> 'volume')::int,
						'mangaChapter',    NULLIF(r.manga_extra_information ->> 'chapter', '')::float8
					))
				WHEN 'on_hold' THEN
					jsonb_strip_nulls(jsonb_build_object(
						'progressPercent', r.clamped_progress,
						'consumedOn',      COALESCE(
							NULLIF(r.providers_consumed_on[r.n_ts], ''),
							NULLIF(r.providers_consumed_on[1], '')
						),
						'startedOn',       CASE WHEN r.started_on IS NOT NULL THEN
							to_char(r.started_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
						END,
						'timeSpent',       r.manual_time_spent / 60.0,
						'animeEpisode',    (r.anime_extra_information ->> 'episode')::int,
						'mangaVolume',     (r.manga_extra_information ->> 'volume')::int,
						'mangaChapter',    NULLIF(r.manga_extra_information ->> 'chapter', '')::float8
					))
			END,
			r.updated_at[r.n_ts],
			CASE
				WHEN r.terminal_slug = 'complete' THEN COALESCE(r.finished_on, r.updated_at[r.n_ts])
				ELSE r.updated_at[r.n_ts]
			END
		FROM rows r
		WHERE r.terminal_slug IS NOT NULL
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_count = ROW_COUNT;
		term_inserted := term_inserted + batch_count;

		cursor_id := next_cursor_id;
	END LOOP;

	SELECT count(*) INTO unresolved_episode_rows
	FROM "seen" s
	INNER JOIN "entity" e ON e.id = s.metadata_id
	LEFT JOIN _legacy_show_episode_resolution show_episode
		ON e.entity_schema_slug = 'show'
		AND show_episode.parent_entity_id = s.metadata_id
		AND show_episode.season_number = s.show_extra_information ->> 'season'
		AND show_episode.episode_number = s.show_extra_information ->> 'episode'
	LEFT JOIN _legacy_podcast_episode_resolution podcast_episode
		ON e.entity_schema_slug = 'podcast'
		AND podcast_episode.parent_entity_id = s.metadata_id
		AND podcast_episode.episode_number = s.podcast_extra_information ->> 'episode'
	WHERE (
			e.entity_schema_slug = 'show'
			AND (s.show_extra_information ->> 'season') ~ '^[0-9]+$'
			AND (s.show_extra_information ->> 'episode') ~ '^[0-9]+$'
			AND show_episode.entity_id IS NULL
		)
		OR (
			e.entity_schema_slug = 'podcast'
			AND (s.podcast_extra_information ->> 'episode') ~ '^[0-9]+$'
			AND podcast_episode.entity_id IS NULL
		);

	IF unresolved_episode_rows > 0 THEN
		RAISE WARNING 'seen -> event: % show/podcast row(s) skipped because their episode could not be resolved positionally; progress/completion for them was not migrated', unresolved_episode_rows;
	END IF;

	RAISE NOTICE 'seen -> event: % progress + % terminal events total (% seconds elapsed)',
		prog_inserted,
		term_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
