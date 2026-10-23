import {
	buildEpisodeAbsentDetailSql,
	buildEpisodeAmbiguousDetailSql,
	buildEpisodeMalformedDetailSql,
	buildEpisodeResolutionFallbackSql,
} from "./episode-resolution-sql";
// Each V1 `seen` row expands to one or more V2 events keyed by its `updated_at` timestamp array:
// InProgress -> N progress events; episodic Completed -> N progress events plus an episode
// completion; other terminal states -> N-1 progress + 1 terminal event. With V1 progress P and M
// generated progress events, rows split into three classes:
// 1. Non-positional rows (flat media, anime/manga without an episode/chapter, show/podcast episodes):
//    progressPercent = ROUND(P*j/M, 2) for j = 1..M when P > 0, otherwise omitted. Terminal
//    dropped/on_hold carry P only when P > 0.
// 2. Positional anime/manga rows: no progressPercent. Position N when the row reached 100 (completed
//    or P >= 100; on progress events only the final one, so completion lands on the finished date),
//    N-1 when partial and N is an integer > 1, omitted otherwise.
// 3. Show/podcast parent dropped/on_hold: no progressPercent and no position.
// Legacy ids are not preserved (one row -> many events); deterministic md5 ids give restart-safety.
// manual_time_spent (seconds) becomes timeSpent (minutes). Unresolved show/podcast episode rows and
// rows whose metadata_id has no migrated entity are skipped. Dropped: review_id, and
// manual_time_spent/started_on on progress events (V2 progress has neither).
import {
	buildAbortOnRowsSql,
	buildAnomalyReportSql,
	buildReportSql,
	buildRequireLegacyTableSql,
	quoteSqlString,
} from "./shared";

const seenReportPhase = "seen -> event";

const seenAbsentDetailSql = buildEpisodeAbsentDetailSql("this watch", "u");

const seenAmbiguousDetailSql = buildEpisodeAmbiguousDetailSql("u");

const seenMalformedDetailSql = buildEpisodeMalformedDetailSql("u");

const buildPositionValueSql = (alias: string) => `CASE
	WHEN ${alias}.position_n > 0 THEN
		CASE
			WHEN ${alias}.reached_full THEN ${alias}.position_n
			WHEN ${alias}.position_n = floor(${alias}.position_n) AND ${alias}.position_n > 1
				THEN ${alias}.position_n - 1
		END
END`;

const buildPositionKeysSql = (
	alias: string,
	value: string,
) => `'animeEpisode', CASE WHEN ${alias}.entity_schema_slug = 'anime' THEN (${value})::int END,
				'mangaChapter', CASE WHEN ${alias}.entity_schema_slug = 'manga' THEN (${value})::float8 END`;

const positionColumnsSql = `
				(
					s.state = 'completed'
					OR s.progress >= 100
				)                                                     AS reached_full,
				CASE e.entity_schema_slug
					WHEN 'anime' THEN (s.anime_extra_information ->> 'episode')::int
					WHEN 'manga' THEN NULLIF(s.manga_extra_information ->> 'chapter', '')::float8
				END                                                   AS position_n,`;

export const buildSeenMigrationSql = (mediaPluginId: string) => `
DO $$
DECLARE
	batch_size     constant int := 500;
	cursor_id      text         := '';
	next_cursor_id text;
	prog_inserted  int          := 0;
	child_complete_inserted int := 0;
	term_inserted  int          := 0;
	unresolved_absent_rows int    := 0;
	unresolved_ambiguous_rows int := 0;
	unresolved_malformed_rows int := 0;
	report_seq     int;
	missing_completion_rows int := 0;
	missing_completion_sample text;
	parent_session_events int   := 0;
	special_episode_events int  := 0;
	batch_count    int;
	index_rec record;
	index_statement text;
	index_statements text[] := ARRAY[]::text[];
	constraint_rec record;
	constraint_statement text;
	constraint_statements text[] := ARRAY[]::text[];
	started_at     timestamptz  := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("seen -> event", "seen")}

	${buildEpisodeResolutionFallbackSql(mediaPluginId)}

	FOR constraint_rec IN
		SELECT conname, pg_get_constraintdef(oid) AS definition
		FROM pg_constraint
		WHERE conrelid = '"event"'::regclass AND contype = 'f'
		ORDER BY conname
	LOOP
		constraint_statements := array_append(constraint_statements,
			format('ALTER TABLE "event" ADD CONSTRAINT %I %s', constraint_rec.conname, constraint_rec.definition));
		EXECUTE format('ALTER TABLE "event" DROP CONSTRAINT %I', constraint_rec.conname);
	END LOOP;

	FOR index_rec IN
		SELECT namespace.nspname, index_class.relname, pg_get_indexdef(index_class.oid) AS definition
		FROM pg_index index_entry
		INNER JOIN pg_class index_class ON index_class.oid = index_entry.indexrelid
		INNER JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
		WHERE index_entry.indrelid = '"event"'::regclass
			AND NOT index_entry.indisunique
			AND NOT EXISTS (
				SELECT 1 FROM pg_constraint constraint_entry
				WHERE constraint_entry.conindid = index_entry.indexrelid
			)
		ORDER BY index_class.relname
	LOOP
		index_statements := array_append(index_statements, index_rec.definition);
		EXECUTE format('DROP INDEX %I.%I', index_rec.nspname, index_rec.relname);
	END LOOP;

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

		INSERT INTO "event" (
			"id",
			"user_id",
			"entity_id",
			"event_schema_slug",
			"event_schema_plugin_id",
			"session_entity_id",
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
				COALESCE(GREATEST(LEAST(s.progress::numeric, 100), 0), 0) AS clamped_progress,
				(
					s.state = 'completed'
					OR (s.state = 'in_progress' AND s.progress >= 100)
				)                                                     AS is_completion_state,${positionColumnsSql}
				s.state IN ('dropped', 'on_a_hold')                   AS is_interrupting_terminal_state,
				s.providers_consumed_on,
				s.show_extra_information,
				s.manga_extra_information,
				s.podcast_extra_information,
				s.finished_on,
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
					WHEN entity_schema_slug = 'show'
						AND show_episode_entity_id IS NOT NULL
						AND (show_extra_information ->> 'season')::int > 0 THEN metadata_id
					WHEN entity_schema_slug = 'podcast'
						AND podcast_episode_entity_id IS NOT NULL THEN metadata_id
				END AS session_entity_id,
				CASE
					WHEN is_completion_state AND is_episodic THEN 100::numeric
					ELSE clamped_progress
				END AS progress_target,
				(
					is_interrupting_terminal_state
					OR (is_completion_state AND NOT is_episodic)
				) AS has_terminal_event,
				COALESCE(position_n > 0, false) AS is_positional
			FROM rows
		)
		SELECT
			md5(r.seen_id || ':p:' || (r.event_idx - 1)::text),
			r.user_id,
			r.target_entity_id,
			'progress',
			${quoteSqlString(mediaPluginId)},
			r.session_entity_id,
			jsonb_strip_nulls(jsonb_build_object(
				'progressPercent',
					CASE
						WHEN r.is_positional OR r.progress_target <= 0 THEN NULL
						ELSE NULLIF(ROUND(
							r.progress_target * r.event_idx::numeric
							  / NULLIF(r.n_ts - CASE WHEN r.has_terminal_event THEN 1 ELSE 0 END, 0),
							2
						), 0)
					END,
				'consumedOn',    NULLIF(r.providers_consumed_on[r.event_idx], ''),
				${buildPositionKeysSql(
					"r",
					`CASE
					WHEN r.reached_full AND (r.has_terminal_event OR r.event_idx < r.n_ts) THEN NULL
					ELSE ${buildPositionValueSql("r")}
				END`,
				)},
				'mangaVolume',   (r.manga_extra_information ->> 'volume')::int
			)),
			r.event_ts,
			CASE
				WHEN r.is_completion_state THEN
					LEAST(r.event_ts, COALESCE(r.finished_on, r.updated_at[r.n_ts]))
				ELSE r.event_ts
			END
		FROM classified r
		WHERE (NOT r.has_terminal_event OR r.event_idx < r.n_ts)
		  AND (r.entity_schema_slug <> 'show' OR r.show_episode_entity_id IS NOT NULL)
		  AND (r.entity_schema_slug <> 'podcast' OR r.podcast_episode_entity_id IS NOT NULL)
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_count = ROW_COUNT;
		prog_inserted := prog_inserted + batch_count;

		-- Completed show and podcast rows become explicit episode completions. The created-at offset
		-- makes completion current when it shares occurredAt with the final progress event.
		INSERT INTO "event" (
			"id",
			"user_id",
			"entity_id",
			"event_schema_slug",
			"event_schema_plugin_id",
			"session_entity_id",
			"properties",
			"created_at",
			"occurred_at"
		)
		WITH rows AS (
			SELECT
				s.id AS seen_id,
				s.user_id,
				s.metadata_id,
				e.entity_schema_slug,
				show_episode.entity_id AS show_episode_entity_id,
				podcast_episode.entity_id AS podcast_episode_entity_id,
				s.providers_consumed_on,
				s.show_extra_information,
				s.finished_on,
				s.updated_at,
				array_length(s.updated_at, 1) AS n_ts
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
			WHERE s.id > cursor_id
			  AND s.id <= next_cursor_id
			  AND e.entity_schema_slug IN ('show', 'podcast')
			  AND (s.state = 'completed' OR (s.state = 'in_progress' AND s.progress >= 100))
		)
		SELECT
			md5(r.seen_id || ':episode-complete'),
			r.user_id,
			COALESCE(r.show_episode_entity_id, r.podcast_episode_entity_id),
			'complete',
			${quoteSqlString(mediaPluginId)},
			CASE
				WHEN r.entity_schema_slug = 'show'
					AND (r.show_extra_information ->> 'season')::int > 0 THEN r.metadata_id
				WHEN r.entity_schema_slug = 'podcast' THEN r.metadata_id
			END,
			jsonb_strip_nulls(jsonb_build_object(
				'consumedOn', COALESCE(
					NULLIF(r.providers_consumed_on[r.n_ts], ''),
					NULLIF(r.providers_consumed_on[1], '')
				)
			)),
			r.updated_at[r.n_ts] + interval '1 millisecond',
			COALESCE(r.finished_on, r.updated_at[r.n_ts])
		FROM rows r
		WHERE (r.entity_schema_slug <> 'show' OR r.show_episode_entity_id IS NOT NULL)
		  AND (r.entity_schema_slug <> 'podcast' OR r.podcast_episode_entity_id IS NOT NULL)
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_count = ROW_COUNT;
		child_complete_inserted := child_complete_inserted + batch_count;

		INSERT INTO "event" (
			"id",
			"user_id",
			"entity_id",
			"event_schema_slug",
			"event_schema_plugin_id",
			"session_entity_id",
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
				COALESCE(GREATEST(LEAST(s.progress::numeric, 100), 0), 0) AS clamped_progress,${positionColumnsSql}
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
			${quoteSqlString(mediaPluginId)},
			CASE WHEN r.entity_schema_slug IN ('show', 'podcast') THEN r.metadata_id END,
			CASE r.terminal_slug
				WHEN 'complete' THEN
					jsonb_strip_nulls(jsonb_build_object(
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
						'progressPercent', CASE
							WHEN r.entity_schema_slug IN ('show', 'podcast') OR r.position_n > 0 THEN NULL
							WHEN r.clamped_progress > 0 THEN r.clamped_progress
						END,
						'consumedOn',      COALESCE(
							NULLIF(r.providers_consumed_on[r.n_ts], ''),
							NULLIF(r.providers_consumed_on[1], '')
						),
						'startedOn',       CASE WHEN r.started_on IS NOT NULL THEN
							to_char(r.started_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
						END,
						'timeSpent',       r.manual_time_spent / 60.0,
						${buildPositionKeysSql("r", buildPositionValueSql("r"))},
						'mangaVolume',     (r.manga_extra_information ->> 'volume')::int
					))
				WHEN 'on_hold' THEN
					jsonb_strip_nulls(jsonb_build_object(
						'progressPercent', CASE
							WHEN r.entity_schema_slug IN ('show', 'podcast') OR r.position_n > 0 THEN NULL
							WHEN r.clamped_progress > 0 THEN r.clamped_progress
						END,
						'consumedOn',      COALESCE(
							NULLIF(r.providers_consumed_on[r.n_ts], ''),
							NULLIF(r.providers_consumed_on[1], '')
						),
						'startedOn',       CASE WHEN r.started_on IS NOT NULL THEN
							to_char(r.started_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
						END,
						'timeSpent',       r.manual_time_spent / 60.0,
						${buildPositionKeysSql("r", buildPositionValueSql("r"))},
						'mangaVolume',     (r.manga_extra_information ->> 'volume')::int
					))
			END,
			r.updated_at[r.n_ts] + CASE
				WHEN r.terminal_slug = 'complete' THEN interval '1 millisecond'
				ELSE interval '0 milliseconds'
			END,
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

	FOREACH index_statement IN ARRAY index_statements LOOP
		EXECUTE index_statement;
	END LOOP;

	FOREACH constraint_statement IN ARRAY constraint_statements LOOP
		EXECUTE constraint_statement;
	END LOOP;

	ANALYZE "event";

	${buildAbortOnRowsSql({
		countVariable: "missing_completion_rows",
		sampleVariable: "missing_completion_sample",
		message:
			"seen -> event: % completed show or podcast watch(es) resolved to an episode but produced no completion event, so those completions would be lost: %. This is a defect in this migration's completion step rather than in the legacy data. Keep the dump and report it; retrying will not change the result.",
		source: `
			SELECT s.id || ' (' || e.name || ')' AS label
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
			LEFT JOIN "event" completion
				ON completion.id = md5(s.id || ':episode-complete')
			WHERE e.entity_schema_slug IN ('show', 'podcast')
			  AND (s.state = 'completed' OR (s.state = 'in_progress' AND s.progress >= 100))
			  AND COALESCE(show_episode.entity_id, podcast_episode.entity_id) IS NOT NULL
			  AND completion.id IS NULL
		`,
	})}

	SELECT count(*) INTO parent_session_events
	FROM "event" ev
	INNER JOIN "entity" child ON child.id = ev.entity_id
	WHERE child.entity_schema_slug IN ('show-episode', 'podcast-episode')
	  AND ev.event_schema_slug IN ('progress', 'complete')
	  AND ev.session_entity_id IS NOT NULL;

	SELECT count(*) INTO special_episode_events
	FROM "event" ev
	INNER JOIN "entity" episode
		ON episode.id = ev.entity_id AND episode.entity_schema_slug = 'show-episode'
	INNER JOIN "relationship" season_episode_rel
		ON season_episode_rel.target_entity_id = episode.id
		AND season_episode_rel.relationship_schema_slug = 'show-season-to-show-episode'
	INNER JOIN "entity" season ON season.id = season_episode_rel.source_entity_id
	WHERE ev.event_schema_slug IN ('progress', 'complete')
	  AND (season.properties ->> 'seasonNumber')::int = 0
	  AND ev.session_entity_id IS NULL;

	CREATE TEMP TABLE _seen_unresolved_positions ON COMMIT DROP AS
	SELECT
		s.id                 AS legacy_record_id,
		s.user_id            AS user_id,
		e.id                 AS parent_entity_id,
		e.name               AS parent_name,
		e.entity_schema_slug AS kind,
		CASE WHEN e.entity_schema_slug = 'show'
			THEN s.show_extra_information ->> 'season' END AS requested_season,
		CASE
			WHEN e.entity_schema_slug = 'show'    THEN s.show_extra_information    ->> 'episode'
			WHEN e.entity_schema_slug = 'podcast' THEN s.podcast_extra_information ->> 'episode'
		END AS requested_episode,
		COALESCE(show_coordinate.candidate_count, podcast_coordinate.candidate_count) AS candidate_count,
		COALESCE(inventory.available_summary, 'none') AS available_summary,
		EXISTS (
			SELECT 1 FROM _legacy_show_episode_coordinates season_probe
			WHERE season_probe.parent_entity_id = e.id
			  AND season_probe.season_number = s.show_extra_information ->> 'season'
		) AS season_exists,
		CASE
			WHEN (e.entity_schema_slug = 'show'
					AND (COALESCE(s.show_extra_information ->> 'season', '')  !~ '^[0-9]+$'
						OR COALESCE(s.show_extra_information ->> 'episode', '') !~ '^[0-9]+$'))
				OR (e.entity_schema_slug = 'podcast'
					AND COALESCE(s.podcast_extra_information ->> 'episode', '') !~ '^[0-9]+$')
				THEN 'malformed'
			WHEN COALESCE(show_coordinate.candidate_count, podcast_coordinate.candidate_count) > 1
				THEN 'ambiguous'
			ELSE 'absent'
		END AS cause
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
	LEFT JOIN _legacy_show_episode_coordinates show_coordinate
		ON e.entity_schema_slug = 'show'
		AND show_coordinate.parent_entity_id = s.metadata_id
		AND show_coordinate.season_number = s.show_extra_information ->> 'season'
		AND show_coordinate.episode_number = s.show_extra_information ->> 'episode'
	LEFT JOIN _legacy_podcast_episode_coordinates podcast_coordinate
		ON e.entity_schema_slug = 'podcast'
		AND podcast_coordinate.parent_entity_id = s.metadata_id
		AND podcast_coordinate.episode_number = s.podcast_extra_information ->> 'episode'
	LEFT JOIN _legacy_episodic_inventory inventory ON inventory.parent_entity_id = e.id
	WHERE (e.entity_schema_slug = 'show' AND show_episode.entity_id IS NULL)
		OR (e.entity_schema_slug = 'podcast' AND podcast_episode.entity_id IS NULL);

	${buildAnomalyReportSql({
		phase: seenReportPhase,
		seqVariable: "report_seq",
		code: "seen-episode-absent",
		detail: seenAbsentDetailSql,
		countVariable: "unresolved_absent_rows",
		source: "_seen_unresolved_positions u WHERE u.cause = 'absent'",
		message:
			"Some watch history was not carried over because the episode it was recorded against does not exist in the show or podcast's stored episode list. Each skipped watch is listed below with what the stored list actually contains.",
	})}

	${buildAnomalyReportSql({
		phase: seenReportPhase,
		seqVariable: "report_seq",
		code: "seen-episode-ambiguous",
		detail: seenAmbiguousDetailSql,
		countVariable: "unresolved_ambiguous_rows",
		source: "_seen_unresolved_positions u WHERE u.cause = 'ambiguous'",
		message:
			"Some watch history was not carried over because more than one stored episode claims the position it was recorded against, so there was no way to tell which episode was watched.",
	})}

	${buildAnomalyReportSql({
		phase: seenReportPhase,
		seqVariable: "report_seq",
		code: "seen-episode-malformed",
		detail: seenMalformedDetailSql,
		countVariable: "unresolved_malformed_rows",
		source: "_seen_unresolved_positions u WHERE u.cause = 'malformed'",
		message:
			"Some show and podcast watch history was not carried over because the legacy row did not record a usable episode number. Each skipped watch is listed below with the value that was actually stored.",
	})}

	${buildReportSql("seen -> event", [
		{ message: "progress", count: "prog_inserted" },
		{ count: "child_complete_inserted", message: "show/podcast episode complete" },
		{ count: "term_inserted", message: "terminal events total" },
		{ count: "parent_session_events", message: "episodic child events assigned parent session" },
		{ count: "special_episode_events", message: "special episode events left sessionless" },
	])}
END $$;
`;
