// V1 review.entity_id (generated COALESCE of the entity FK columns) equals the V2 entity.id since
// legacy ids are preserved; reviews whose entity was not migrated are skipped via INNER JOIN.
// Ratings are clamped to 100 via a CASE guard — LEAST(NULL, 100) returns 100, not NULL. Manga
// chapter is a rust_decimal JSON string, extracted with ->> before ::float8. Dropped: visibility,
// comments (no V2 equivalent).
export const buildReviewMigrationSql = () => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	unresolved_episode_rows int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"review"') IS NULL THEN
		RAISE EXCEPTION 'Expected review table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'review -> event: migration started (% seconds elapsed)', 0.0;

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
			episode.entity_schema_id
		FROM "entity" show_entity
		INNER JOIN "entity_schema" show_schema
			ON  show_schema.id   = show_entity.entity_schema_id
			AND show_schema.slug = 'show'
		INNER JOIN "relationship" show_season_rel
			ON show_season_rel.source_entity_id = show_entity.id
		INNER JOIN "relationship_schema" show_season_rs
			ON  show_season_rs.id      = show_season_rel.relationship_schema_id
			AND show_season_rs.slug    = 'show-to-show-season'
			AND show_season_rs.user_id IS NULL
		INNER JOIN "entity" season
			ON season.id = show_season_rel.target_entity_id
		INNER JOIN "entity_schema" season_schema
			ON  season_schema.id   = season.entity_schema_id
			AND season_schema.slug = 'show-season'
		INNER JOIN "relationship" season_episode_rel
			ON season_episode_rel.source_entity_id = season.id
		INNER JOIN "relationship_schema" season_episode_rs
			ON  season_episode_rs.id      = season_episode_rel.relationship_schema_id
			AND season_episode_rs.slug    = 'show-season-to-show-episode'
			AND season_episode_rs.user_id IS NULL
		INNER JOIN "entity" episode
			ON episode.id = season_episode_rel.target_entity_id
		INNER JOIN "entity_schema" episode_schema
			ON  episode_schema.id   = episode.entity_schema_id
			AND episode_schema.slug = 'show-episode'
		WHERE (show_season_rel.user_id = show_entity.user_id OR show_season_rel.user_id IS NULL)
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
			episode.entity_schema_id
		FROM "entity" podcast
		INNER JOIN "entity_schema" podcast_schema
			ON  podcast_schema.id   = podcast.entity_schema_id
			AND podcast_schema.slug = 'podcast'
		INNER JOIN "relationship" podcast_episode_rel
			ON podcast_episode_rel.source_entity_id = podcast.id
		INNER JOIN "relationship_schema" podcast_episode_rs
			ON  podcast_episode_rs.id      = podcast_episode_rel.relationship_schema_id
			AND podcast_episode_rs.slug    = 'podcast-to-podcast-episode'
			AND podcast_episode_rs.user_id IS NULL
		INNER JOIN "entity" episode
			ON episode.id = podcast_episode_rel.target_entity_id
		INNER JOIN "entity_schema" episode_schema
			ON  episode_schema.id   = episode.entity_schema_id
			AND episode_schema.slug = 'podcast-episode'
		WHERE (podcast_episode_rel.user_id = podcast.user_id OR podcast_episode_rel.user_id IS NULL)
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
			SELECT r.id AS id
			FROM "review" r
			WHERE r.id > cursor_id
			ORDER BY r.id
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		INSERT INTO "event" (
			"id",
			"user_id",
			"entity_id",
			"event_schema_id",
			"properties",
			"created_at",
			"occurred_at"
		)
		WITH rows AS (
			SELECT
				r.id,
				r.user_id,
				r.entity_id,
				r.rating,
				r.text,
				r.is_spoiler,
				r.anime_extra_information,
				r.manga_extra_information,
				r.show_extra_information,
				r.podcast_extra_information,
				r.posted_on,
				e.entity_schema_id,
				entity_schema.slug AS entity_schema_slug,
				show_episode.entity_id AS show_episode_entity_id,
				show_episode.entity_schema_id AS show_episode_entity_schema_id,
				podcast_episode.entity_id AS podcast_episode_entity_id,
				podcast_episode.entity_schema_id AS podcast_episode_entity_schema_id,
				(r.show_extra_information ->> 'season') ~ '^[0-9]+$'
					AND (r.show_extra_information ->> 'episode') ~ '^[0-9]+$' AS has_show_episode_locator,
				(r.podcast_extra_information ->> 'episode') ~ '^[0-9]+$' AS has_podcast_episode_locator
			FROM "review" r
			INNER JOIN "entity" e ON e.id = r.entity_id
			INNER JOIN "entity_schema" entity_schema ON entity_schema.id = e.entity_schema_id
			LEFT JOIN _legacy_show_episode_resolution show_episode
				ON entity_schema.slug = 'show'
				AND show_episode.parent_entity_id = r.entity_id
				AND show_episode.season_number = r.show_extra_information ->> 'season'
				AND show_episode.episode_number = r.show_extra_information ->> 'episode'
				AND (r.show_extra_information ->> 'season') ~ '^[0-9]+$'
				AND (r.show_extra_information ->> 'episode') ~ '^[0-9]+$'
			LEFT JOIN _legacy_podcast_episode_resolution podcast_episode
				ON entity_schema.slug = 'podcast'
				AND podcast_episode.parent_entity_id = r.entity_id
				AND podcast_episode.episode_number = r.podcast_extra_information ->> 'episode'
				AND (r.podcast_extra_information ->> 'episode') ~ '^[0-9]+$'
			WHERE r.id > cursor_id
			  AND r.id <= next_cursor_id
		)
		SELECT
			r.id,
			r.user_id,
			COALESCE(r.show_episode_entity_id, r.podcast_episode_entity_id, r.entity_id),
			es.id,
			jsonb_strip_nulls(jsonb_build_object(
				'rating',       CASE WHEN r.rating IS NOT NULL THEN LEAST(r.rating, 100) END,
				'text',         NULLIF(r.text, ''),
				'isSpoiler',    r.is_spoiler,
				'animeEpisode', (r.anime_extra_information ->> 'episode')::int,
				'mangaVolume',  (r.manga_extra_information ->> 'volume')::int,
				'mangaChapter', NULLIF(r.manga_extra_information ->> 'chapter', '')::float8
			)),
			r.posted_on,
			r.posted_on
		FROM rows r
		INNER JOIN "event_schema" es
			ON es.entity_schema_id = COALESCE(
				r.show_episode_entity_schema_id,
				r.podcast_episode_entity_schema_id,
				r.entity_schema_id
			)
			AND es.slug = 'review'
			AND es.user_id IS NULL
		WHERE NOT (
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
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
	END LOOP;

	SELECT count(*) INTO unresolved_episode_rows
	FROM "review" rv
	INNER JOIN "entity" e ON e.id = rv.entity_id
	INNER JOIN "entity_schema" es ON es.id = e.entity_schema_id
	LEFT JOIN _legacy_show_episode_resolution show_episode
		ON es.slug = 'show'
		AND show_episode.parent_entity_id = rv.entity_id
		AND show_episode.season_number = rv.show_extra_information ->> 'season'
		AND show_episode.episode_number = rv.show_extra_information ->> 'episode'
	LEFT JOIN _legacy_podcast_episode_resolution podcast_episode
		ON es.slug = 'podcast'
		AND podcast_episode.parent_entity_id = rv.entity_id
		AND podcast_episode.episode_number = rv.podcast_extra_information ->> 'episode'
	WHERE (
			es.slug = 'show'
			AND (rv.show_extra_information ->> 'season') ~ '^[0-9]+$'
			AND (rv.show_extra_information ->> 'episode') ~ '^[0-9]+$'
			AND show_episode.entity_id IS NULL
		)
		OR (
			es.slug = 'podcast'
			AND (rv.podcast_extra_information ->> 'episode') ~ '^[0-9]+$'
			AND podcast_episode.entity_id IS NULL
		);

	IF unresolved_episode_rows > 0 THEN
		RAISE WARNING 'review -> event: % show/podcast review(s) skipped because their episode could not be resolved positionally; these reviews were not migrated', unresolved_episode_rows;
	END IF;

	RAISE NOTICE 'review -> event: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
