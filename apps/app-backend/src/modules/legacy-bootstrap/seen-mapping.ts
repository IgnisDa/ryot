// Seen -> event migration.
//
// Each V1 `seen` row maps to one or more V2 events based on its `updated_at` array and `state`.
// The `updated_at` array records every timestamp at which the row was mutated. Legacy IDs for
// `seen` are NOT preserved because one V1 row expands to multiple V2 events; deterministic
// md5-based IDs are used for restart-safety instead.
//
// --- Progress-event generation ---
//
// `InProgress` rows (N timestamps) -> N progress events, one per updated_at entry.
// `Completed` rows for episodic media (show/anime/manga/podcast) -> N progress events, with the
// final event set to progressPercent=100 and carrying the episode/chapter key. A later migration
// pass emits whole-entity `complete` events per detected watch-through.
// Other terminal rows (non-episodic Completed/Dropped/OnAHold, N timestamps) -> N-1 progress
// events + 1 terminal event. When N=1 for those rows, only the terminal event is created.
//
// progressPercent is linearly interpolated from 1 to the target percentage. In the formulas below,
// j is the zero-based position of the generated progress event:
//   Full progress stream (M events): percent[j] = ROUND(1 + (P-1)*j/(M-1), 2); if M=1 then P
//   Before terminal   (M events): percent[j] = ROUND(1 + (P-1)*j/(M-1), 2); if M=1 then 1
//
// `progress` is clamped to [1, 100]. V1 rows with progress=0 emit 1. V1 rows with progress>=100
// and state=InProgress are treated as Completed.
//
// --- providers_consumed_on ---
//
// Progress events receive providers_consumed_on[event_position] (1-indexed array access;
// PostgreSQL returns NULL for out-of-bounds access, which jsonb_strip_nulls then drops).
// The terminal event receives providers_consumed_on[n_timestamps] if it exists, otherwise
// providers_consumed_on[1] as a fallback.
//
// --- Timestamps ---
//
// Each progress event's `created_at` is set to the corresponding `updated_at[i]` entry.
// The terminal event's `created_at` is set to `updated_at[N]` (the last entry).
// `completedOn` on non-episodic `complete` events uses `finished_on` when set, otherwise
// `updated_at[N]`. `startedOn` on `complete`/`dropped`/`on_hold` events uses `started_on` when set.
//
// --- Units ---
//
// `manual_time_spent` is stored in seconds in V1. V2 `timeSpent` is in minutes. Division by 60
// is applied during migration.
//
// --- Skipped data ---
//
// `review_id` (seen-to-review linkage): no inter-event references exist in V2; dropped.
// `manual_time_spent` on InProgress rows and episodic completion progress rows: `progress` events
// have no `timeSpent` field; dropped.
// `started_on` on InProgress rows and episodic completion progress rows: `progress` events have no
// `startedOn` field; dropped.
// `seen` rows whose metadata_id has no matching V2 entity are silently skipped (INNER JOIN).
//
// V1 SeenState serialisation (SeaORM snake_case):
//   Completed -> 'completed', InProgress -> 'in_progress',
//   Dropped -> 'dropped', OnAHold -> 'on_a_hold'

export const buildSeenMigrationSql = () => `
DO $$
DECLARE
	batch_size     constant int := 500;
	cursor_id      text         := '';
	next_cursor_id text;
	prog_inserted  int          := 0;
	term_inserted  int          := 0;
	batch_count    int;
	started_at     timestamptz  := clock_timestamp();
BEGIN
	IF to_regclass('"seen"') IS NULL THEN
		RAISE EXCEPTION 'Expected seen table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'seen -> event: migration started (% seconds elapsed)', 0.0;

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
			"event_schema_id",
			"properties",
			"created_at"
		)
		WITH rows AS (
			SELECT
				s.id                                                  AS seen_id,
				s.user_id,
				s.metadata_id,
				entity_schema.slug                                    AS entity_schema_slug,
				entity_schema.slug IN ('show', 'anime', 'manga', 'podcast') AS is_episodic,
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
			INNER JOIN "entity_schema" entity_schema ON entity_schema.id = e.entity_schema_id
			CROSS JOIN LATERAL unnest(s.updated_at) WITH ORDINALITY AS t(ts, idx)
			WHERE s.id > cursor_id
			  AND s.id <= next_cursor_id
		), classified AS (
			SELECT
				*,
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
			r.metadata_id,
			es.id,
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
				'showSeason',    (r.show_extra_information ->> 'season')::int,
				'showEpisode',   (r.show_extra_information ->> 'episode')::int,
				'animeEpisode',  (r.anime_extra_information ->> 'episode')::int,
				'mangaVolume',   (r.manga_extra_information ->> 'volume')::int,
				'mangaChapter',  NULLIF(r.manga_extra_information ->> 'chapter', '')::float8,
				'podcastEpisode',(r.podcast_extra_information ->> 'episode')::int
			)),
			r.event_ts
		FROM classified r
		INNER JOIN "entity" e  ON e.id = r.metadata_id
		INNER JOIN "event_schema" es
			ON  es.entity_schema_id = e.entity_schema_id
			AND es.slug             = 'progress'
			AND es.user_id          IS NULL
		WHERE NOT r.has_terminal_event OR r.event_idx < r.n_ts
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_count = ROW_COUNT;
		prog_inserted := prog_inserted + batch_count;

		-- Terminal events: non-episodic complete, dropped, and on_hold.
		INSERT INTO "event" (
			"id",
			"user_id",
			"entity_id",
			"event_schema_id",
			"properties",
			"created_at"
		)
		WITH rows AS (
			SELECT
				s.id                                                  AS seen_id,
				s.user_id,
				s.metadata_id,
				e.entity_schema_id,
				entity_schema.slug IN ('show', 'anime', 'manga', 'podcast') AS is_episodic,
				GREATEST(LEAST(s.progress::numeric, 100), 1)          AS clamped_progress,
				CASE
					WHEN s.state = 'dropped' THEN 'dropped'
					WHEN s.state = 'on_a_hold' THEN 'on_hold'
					WHEN (
						s.state = 'completed'
						OR (s.state = 'in_progress' AND s.progress >= 100)
					) AND entity_schema.slug NOT IN ('show', 'anime', 'manga', 'podcast') THEN 'complete'
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
			INNER JOIN "entity_schema" entity_schema ON entity_schema.id = e.entity_schema_id
			WHERE s.id > cursor_id
			  AND s.id <= next_cursor_id
		)
		SELECT
			md5(r.seen_id || ':t'),
			r.user_id,
			r.metadata_id,
			es.id,
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
						'showSeason',      (r.show_extra_information ->> 'season')::int,
						'showEpisode',     (r.show_extra_information ->> 'episode')::int,
						'animeEpisode',    (r.anime_extra_information ->> 'episode')::int,
						'mangaVolume',     (r.manga_extra_information ->> 'volume')::int,
						'mangaChapter',    NULLIF(r.manga_extra_information ->> 'chapter', '')::float8,
						'podcastEpisode',  (r.podcast_extra_information ->> 'episode')::int
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
						'showSeason',      (r.show_extra_information ->> 'season')::int,
						'showEpisode',     (r.show_extra_information ->> 'episode')::int,
						'animeEpisode',    (r.anime_extra_information ->> 'episode')::int,
						'mangaVolume',     (r.manga_extra_information ->> 'volume')::int,
						'mangaChapter',    NULLIF(r.manga_extra_information ->> 'chapter', '')::float8,
						'podcastEpisode',  (r.podcast_extra_information ->> 'episode')::int
					))
			END,
			r.updated_at[r.n_ts]
		FROM rows r
		INNER JOIN "event_schema" es
			ON  es.entity_schema_id = r.entity_schema_id
			AND es.slug             = r.terminal_slug
			AND es.user_id          IS NULL
		WHERE r.terminal_slug IS NOT NULL
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_count = ROW_COUNT;
		term_inserted := term_inserted + batch_count;

		cursor_id := next_cursor_id;
	END LOOP;

	RAISE NOTICE 'seen -> event: % progress + % terminal events total (% seconds elapsed)',
		prog_inserted,
		term_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
