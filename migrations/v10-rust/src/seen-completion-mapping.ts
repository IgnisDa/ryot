// Backfills whole-entity `complete` events for episodic media. Show and podcast coverage replays
// child progress/completion in lifecycle order; anime and manga retain their positional pass model.
import { buildReportSql, quoteSqlString } from "./shared";

export const buildSeenEpisodicCompletionMigrationSql = (mediaPluginId: string) => `
DO $$
DECLARE
	entity_rec record;
	event_rec record;
	covered_keys text[];
	covered_consumed_on jsonb;
	agreed_consumed_on text;
	batch_count int;
	show_podcast_complete_inserted int := 0;
	flat_complete_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	CREATE TEMP TABLE _seen_required_coverage ON COMMIT DROP AS
	WITH show_keys AS (
		SELECT DISTINCT
			show_entity.id AS entity_id,
			'show' AS entity_schema_slug,
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
		  AND (season.properties ->> 'seasonNumber')::int > 0
	), podcast_keys AS (
		SELECT DISTINCT
			podcast.id AS entity_id,
			'podcast' AS entity_schema_slug,
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
	), anime_keys AS (
		SELECT
			e.id AS entity_id,
			'anime' AS entity_schema_slug,
			gs::text AS coverage_key
		FROM "entity" e
		CROSS JOIN LATERAL generate_series(1, (e.properties ->> 'episodes')::int) AS gs
		WHERE e.entity_schema_slug = 'anime'
		  AND (e.properties ->> 'episodes') ~ '^[0-9]+$'
		  AND (e.properties ->> 'episodes')::int > 0
	), manga_counts AS (
		SELECT
			e.id AS entity_id,
			(e.properties ->> 'chapters')::numeric AS chapter_count
		FROM "entity" e
		WHERE e.entity_schema_slug = 'manga'
		  AND (e.properties ->> 'chapters') ~ '^[0-9]+(\\.[0-9]+)?$'
		  AND (e.properties ->> 'chapters')::numeric > 0
	), manga_keys AS (
		SELECT entity_id, 'manga' AS entity_schema_slug, gs::text AS coverage_key
		FROM manga_counts
		CROSS JOIN LATERAL generate_series(1, floor(chapter_count)::int) AS gs
		UNION ALL
		SELECT entity_id, 'manga', (chapter_count::float8)::text
		FROM manga_counts
		WHERE chapter_count <> floor(chapter_count)
	)
	SELECT * FROM show_keys
	UNION ALL SELECT * FROM podcast_keys
	UNION ALL SELECT * FROM anime_keys
	UNION ALL SELECT * FROM manga_keys;

	CREATE INDEX ON _seen_required_coverage (entity_id, coverage_key);

	-- A show is valid only when it has a nonempty regular-season graph. Empty regular seasons remain
	-- visible through the left joins and prevent 0 == 0 completion.
	CREATE TEMP TABLE _seen_required_counts ON COMMIT DROP AS
	WITH show_seasons AS (
		SELECT
			show_entity.id AS entity_id,
			season.id AS season_id,
			count(DISTINCT episode.id)::int AS episode_count
		FROM "entity" show_entity
		INNER JOIN "relationship" show_season_rel
			ON  show_season_rel.source_entity_id = show_entity.id
			AND show_season_rel.relationship_schema_slug = 'show-to-show-season'
		INNER JOIN "entity" season
			ON  season.id = show_season_rel.target_entity_id
			AND season.entity_schema_slug = 'show-season'
		LEFT JOIN "relationship" season_episode_rel
			ON  season_episode_rel.source_entity_id = season.id
			AND season_episode_rel.relationship_schema_slug = 'show-season-to-show-episode'
		LEFT JOIN "entity" episode
			ON  episode.id = season_episode_rel.target_entity_id
			AND episode.entity_schema_slug = 'show-episode'
		WHERE show_entity.entity_schema_slug = 'show'
		  AND (show_season_rel.user_id IS NULL OR show_season_rel.user_id = show_entity.user_id)
		  AND (season_episode_rel.user_id IS NULL OR season_episode_rel.user_id = show_entity.user_id)
		  AND (season.user_id IS NULL OR season.user_id = show_entity.user_id)
		  AND (episode.user_id IS NULL OR episode.user_id = show_entity.user_id)
		  AND (season.properties ->> 'seasonNumber') ~ '^[0-9]+$'
		  AND (season.properties ->> 'seasonNumber')::int > 0
		GROUP BY show_entity.id, season.id
	), valid_shows AS (
		SELECT entity_id, sum(episode_count)::int AS required_count
		FROM show_seasons
		GROUP BY entity_id
		HAVING count(*) > 0 AND bool_and(episode_count > 0) AND sum(episode_count) > 0
	), other_counts AS (
		SELECT entity_id, entity_schema_slug, count(*)::int AS required_count
		FROM _seen_required_coverage
		WHERE entity_schema_slug IN ('podcast', 'anime', 'manga')
		GROUP BY entity_id, entity_schema_slug
		HAVING count(*) > 0
	)
	SELECT entity_id, 'show' AS entity_schema_slug, required_count FROM valid_shows
	UNION ALL
	SELECT entity_id, entity_schema_slug, required_count FROM other_counts;

	CREATE UNIQUE INDEX ON _seen_required_counts (entity_id);

	CREATE TEMP TABLE _seen_child_lifecycle ON COMMIT DROP AS
	SELECT
		ev.id AS event_id,
		ev.user_id,
		ev.session_entity_id AS entity_id,
		ev.entity_id AS coverage_key,
		ev.event_schema_slug,
		ev.created_at,
		ev.occurred_at,
		NULLIF(ev.properties ->> 'consumedOn', '') AS consumed_on
	FROM "event" ev
	INNER JOIN _seen_required_coverage required
		ON  required.entity_id = ev.session_entity_id
		AND required.coverage_key = ev.entity_id
		AND required.entity_schema_slug IN ('show', 'podcast')
	WHERE ev.event_schema_slug IN ('progress', 'complete');

	CREATE INDEX ON _seen_child_lifecycle (
		user_id,
		entity_id,
		occurred_at,
		created_at,
		event_id
	);
	ANALYZE _seen_required_coverage;
	ANALYZE _seen_required_counts;
	ANALYZE _seen_child_lifecycle;

	FOR entity_rec IN
		SELECT DISTINCT
			child.user_id,
			child.entity_id,
			required.required_count
		FROM _seen_child_lifecycle child
		INNER JOIN _seen_required_counts required
			ON  required.entity_id = child.entity_id
			AND required.entity_schema_slug IN ('show', 'podcast')
		INNER JOIN "metadata" legacy_metadata ON legacy_metadata.id = child.entity_id
		WHERE lower(trim(legacy_metadata.production_status)) IN ('ended', 'canceled', 'cancelled')
		ORDER BY child.user_id, child.entity_id
	LOOP
		covered_keys := ARRAY[]::text[];
		covered_consumed_on := '{}'::jsonb;

		FOR event_rec IN
			SELECT event_id, coverage_key, event_schema_slug, created_at, occurred_at, consumed_on
			FROM _seen_child_lifecycle
			WHERE user_id = entity_rec.user_id
			  AND entity_id = entity_rec.entity_id
			ORDER BY occurred_at, created_at, event_id
		LOOP
			IF event_rec.event_schema_slug = 'progress' THEN
				covered_keys := array_remove(covered_keys, event_rec.coverage_key);
				covered_consumed_on := covered_consumed_on - event_rec.coverage_key;
			ELSE
				IF NOT (event_rec.coverage_key = ANY(covered_keys)) THEN
					covered_keys := covered_keys || event_rec.coverage_key;
				END IF;
				covered_consumed_on := jsonb_set(
					covered_consumed_on,
					ARRAY[event_rec.coverage_key],
					COALESCE(to_jsonb(event_rec.consumed_on), 'null'::jsonb),
					true
				);
			END IF;

			IF COALESCE(array_length(covered_keys, 1), 0) = entity_rec.required_count THEN
				SELECT CASE
					WHEN count(*) FILTER (WHERE value IS NOT NULL AND value <> '') = entity_rec.required_count
						AND count(DISTINCT value) = 1 THEN min(value)
				END
			INTO agreed_consumed_on
			FROM jsonb_each_text(covered_consumed_on);

				-- The suffix places the boundary directly after its closing child when timestamps tie,
				-- without moving it past the next child event in the total event order.
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
				VALUES (
					event_rec.event_id || ':parent-complete',
					entity_rec.user_id,
					entity_rec.entity_id,
					'complete',
					${quoteSqlString(mediaPluginId)},
					entity_rec.entity_id,
					jsonb_strip_nulls(jsonb_build_object(
						'completionMode', 'custom_timestamps',
						'completedOn', to_char(
							event_rec.occurred_at AT TIME ZONE 'UTC',
							'YYYY-MM-DD"T"HH24:MI:SS"Z"'
						),
						'consumedOn', agreed_consumed_on
					)),
					event_rec.created_at,
					event_rec.occurred_at
				)
				ON CONFLICT DO NOTHING;
				GET DIAGNOSTICS batch_count = ROW_COUNT;
				show_podcast_complete_inserted := show_podcast_complete_inserted + batch_count;
				covered_keys := ARRAY[]::text[];
				covered_consumed_on := '{}'::jsonb;
			END IF;
		END LOOP;
	END LOOP;

	-- Preserve the established positional full-pass behavior for anime and manga.
	CREATE TEMP TABLE _seen_flat_progress_coverage ON COMMIT DROP AS
	SELECT
		ev.id AS event_id,
		ev.user_id,
		ev.entity_id,
		ev.created_at,
		ev.occurred_at,
		NULLIF(ev.properties ->> 'consumedOn', '') AS consumed_on,
		CASE e.entity_schema_slug
			WHEN 'anime' THEN
				CASE WHEN (ev.properties ->> 'animeEpisode') ~ '^[0-9]+$'
				THEN ev.properties ->> 'animeEpisode' END
			WHEN 'manga' THEN
				CASE WHEN (ev.properties ->> 'mangaChapter') ~ '^[0-9]+(\\.[0-9]+)?$'
				THEN ((ev.properties ->> 'mangaChapter')::float8)::text END
		END AS coverage_key
	FROM "event" ev
	INNER JOIN "entity" e ON e.id = ev.entity_id
	WHERE ev.event_schema_slug = 'progress'
	  AND e.entity_schema_slug IN ('anime', 'manga')
	  AND (ev.properties ->> 'progressPercent')::numeric = 100;

	DELETE FROM _seen_flat_progress_coverage progress
	WHERE NOT EXISTS (
		SELECT 1
		FROM _seen_required_coverage required
		WHERE required.entity_id = progress.entity_id
		  AND required.coverage_key = progress.coverage_key
		  AND required.entity_schema_slug IN ('anime', 'manga')
	);

	CREATE INDEX ON _seen_flat_progress_coverage (
		user_id,
		entity_id,
		occurred_at,
		created_at,
		event_id
	);
	ANALYZE _seen_flat_progress_coverage;

	FOR entity_rec IN
		SELECT DISTINCT
			progress.user_id,
			progress.entity_id,
			required.required_count
		FROM _seen_flat_progress_coverage progress
		INNER JOIN _seen_required_counts required
			ON required.entity_id = progress.entity_id
			AND required.entity_schema_slug IN ('anime', 'manga')
		ORDER BY progress.user_id, progress.entity_id
	LOOP
		covered_keys := ARRAY[]::text[];

		FOR event_rec IN
			SELECT event_id, created_at, occurred_at, consumed_on, coverage_key
			FROM _seen_flat_progress_coverage
			WHERE user_id = entity_rec.user_id
			  AND entity_id = entity_rec.entity_id
			ORDER BY occurred_at, created_at, event_id
		LOOP
			IF NOT (event_rec.coverage_key = ANY(covered_keys)) THEN
				covered_keys := covered_keys || event_rec.coverage_key;
			END IF;

			IF COALESCE(array_length(covered_keys, 1), 0) = entity_rec.required_count THEN
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
				VALUES (
					md5(
						entity_rec.user_id || ':' || entity_rec.entity_id
						|| ':episodic-complete:' || event_rec.event_id
					),
					entity_rec.user_id,
					entity_rec.entity_id,
					'complete',
					${quoteSqlString(mediaPluginId)},
					jsonb_strip_nulls(jsonb_build_object(
						'completionMode', 'custom_timestamps',
						'completedOn', to_char(
							event_rec.occurred_at AT TIME ZONE 'UTC',
							'YYYY-MM-DD"T"HH24:MI:SS"Z"'
						),
						'consumedOn', event_rec.consumed_on
					)),
					event_rec.created_at,
					event_rec.occurred_at
				)
				ON CONFLICT DO NOTHING;
				GET DIAGNOSTICS batch_count = ROW_COUNT;
				flat_complete_inserted := flat_complete_inserted + batch_count;
				covered_keys := ARRAY[]::text[];
			END IF;
		END LOOP;
	END LOOP;

	IF EXISTS (
		SELECT 1
		FROM "event" ev
		INNER JOIN "entity" parent ON parent.id = ev.entity_id
		WHERE parent.entity_schema_slug IN ('show', 'podcast')
		  AND ev.event_schema_slug IN ('backlog', 'complete', 'dropped', 'on_hold')
		  AND ev.session_entity_id IS DISTINCT FROM ev.entity_id
	) THEN
		RAISE EXCEPTION 'Migrated show/podcast parent lifecycle event has invalid session_entity_id';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "event" ev
		INNER JOIN "entity" parent ON parent.id = ev.entity_id
		WHERE parent.entity_schema_slug IN ('show', 'podcast')
		  AND ev.event_schema_slug = 'progress'
	) THEN
		RAISE EXCEPTION 'Migrated show/podcast parent must not have progress events';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "event" ev
		INNER JOIN "entity" episode
			ON episode.id = ev.entity_id AND episode.entity_schema_slug = 'show-episode'
		INNER JOIN "relationship" season_episode_rel
			ON season_episode_rel.target_entity_id = episode.id
			AND season_episode_rel.relationship_schema_slug = 'show-season-to-show-episode'
		INNER JOIN "entity" season ON season.id = season_episode_rel.source_entity_id
		INNER JOIN "relationship" show_season_rel
			ON show_season_rel.target_entity_id = season.id
			AND show_season_rel.relationship_schema_slug = 'show-to-show-season'
		WHERE ev.event_schema_slug IN ('progress', 'complete')
		  AND (
			((season.properties ->> 'seasonNumber')::int > 0
				AND ev.session_entity_id IS DISTINCT FROM show_season_rel.source_entity_id)
			OR ((season.properties ->> 'seasonNumber')::int = 0
				AND ev.session_entity_id IS NOT NULL)
		  )
	) THEN
		RAISE EXCEPTION 'Migrated show episode lifecycle event has invalid session_entity_id';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "event" ev
		INNER JOIN "entity" episode
			ON episode.id = ev.entity_id AND episode.entity_schema_slug = 'podcast-episode'
		INNER JOIN "relationship" podcast_episode_rel
			ON podcast_episode_rel.target_entity_id = episode.id
			AND podcast_episode_rel.relationship_schema_slug = 'podcast-to-podcast-episode'
		WHERE ev.event_schema_slug IN ('progress', 'complete')
		  AND ev.session_entity_id IS DISTINCT FROM podcast_episode_rel.source_entity_id
	) THEN
		RAISE EXCEPTION 'Migrated podcast episode lifecycle event has invalid session_entity_id';
	END IF;

	${buildReportSql("seen -> event", [
		{
			count: "show_podcast_complete_inserted",
			message: "show/podcast parent complete events backfilled",
		},
		{ count: "flat_complete_inserted", message: "anime/manga complete events backfilled" },
	])}
END $$;
`;
