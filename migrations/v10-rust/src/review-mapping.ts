import {
	buildEpisodeAbsentDetailSql,
	buildEpisodeAmbiguousDetailSql,
	buildEpisodeResolutionFallbackSql,
} from "./episode-resolution-sql";
// V1 review.entity_id (generated COALESCE of the entity FK columns) equals the V2 entity.id since
// legacy ids are preserved; reviews whose entity was not migrated are skipped via INNER JOIN.
// Ratings are clamped to 100 via a CASE guard — LEAST(NULL, 100) returns 100, not NULL. Manga
// chapter is a rust_decimal JSON string, extracted with ->> before ::float8. Dropped: visibility,
// comments (no V2 equivalent).
import { buildRequireLegacyTableSql, buildAnomalyReportSql, buildReportSql } from "./shared";

const reviewReportPhase = "review -> event";

const reviewAbsentDetailSql = buildEpisodeAbsentDetailSql("review-episode-absent", "u");

const reviewAmbiguousDetailSql = buildEpisodeAmbiguousDetailSql("review-episode-ambiguous", "u");

export const buildReviewMigrationSql = () => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	unresolved_absent_rows int := 0;
	unresolved_ambiguous_rows int := 0;
	report_seq int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("review -> event", "review")}

	${buildEpisodeResolutionFallbackSql()}

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
			"event_schema_slug",
			"event_schema_plugin_id",
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
				e.entity_schema_slug,
				e.entity_schema_plugin_id,
				show_episode.entity_id AS show_episode_entity_id,
				podcast_episode.entity_id AS podcast_episode_entity_id,
				(r.show_extra_information ->> 'season') ~ '^[0-9]+$'
					AND (r.show_extra_information ->> 'episode') ~ '^[0-9]+$' AS has_show_episode_locator,
				(r.podcast_extra_information ->> 'episode') ~ '^[0-9]+$' AS has_podcast_episode_locator
			FROM "review" r
			INNER JOIN "entity" e ON e.id = r.entity_id
			LEFT JOIN _legacy_show_episode_resolution show_episode
				ON e.entity_schema_slug = 'show'
				AND show_episode.parent_entity_id = r.entity_id
				AND show_episode.season_number = r.show_extra_information ->> 'season'
				AND show_episode.episode_number = r.show_extra_information ->> 'episode'
				AND (r.show_extra_information ->> 'season') ~ '^[0-9]+$'
				AND (r.show_extra_information ->> 'episode') ~ '^[0-9]+$'
			LEFT JOIN _legacy_podcast_episode_resolution podcast_episode
				ON e.entity_schema_slug = 'podcast'
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
			'review',
			r.entity_schema_plugin_id,
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

	-- Reviews keep the numeric guards below, so an unresolved review is either absent from the stored
	-- episode list or claimed by several episodes, never malformed as a seen row can be.
	CREATE TEMP TABLE _review_unresolved_positions ON COMMIT DROP AS
	SELECT
		rv.id                AS legacy_record_id,
		rv.user_id           AS user_id,
		e.id                 AS parent_entity_id,
		e.name               AS parent_name,
		e.entity_schema_slug AS kind,
		CASE WHEN e.entity_schema_slug = 'show'
			THEN rv.show_extra_information ->> 'season' END AS requested_season,
		CASE
			WHEN e.entity_schema_slug = 'show'    THEN rv.show_extra_information    ->> 'episode'
			WHEN e.entity_schema_slug = 'podcast' THEN rv.podcast_extra_information ->> 'episode'
		END AS requested_episode,
		COALESCE(show_coordinate.candidate_count, podcast_coordinate.candidate_count) AS candidate_count,
		COALESCE(inventory.available_summary, 'none') AS available_summary,
		EXISTS (
			SELECT 1 FROM _legacy_show_episode_coordinates season_probe
			WHERE season_probe.parent_entity_id = e.id
			  AND season_probe.season_number = rv.show_extra_information ->> 'season'
		) AS season_exists,
		CASE
			WHEN COALESCE(show_coordinate.candidate_count, podcast_coordinate.candidate_count) > 1
				THEN 'ambiguous'
			ELSE 'absent'
		END AS cause
	FROM "review" rv
	INNER JOIN "entity" e ON e.id = rv.entity_id
	LEFT JOIN _legacy_show_episode_resolution show_episode
		ON e.entity_schema_slug = 'show'
		AND show_episode.parent_entity_id = rv.entity_id
		AND show_episode.season_number = rv.show_extra_information ->> 'season'
		AND show_episode.episode_number = rv.show_extra_information ->> 'episode'
	LEFT JOIN _legacy_podcast_episode_resolution podcast_episode
		ON e.entity_schema_slug = 'podcast'
		AND podcast_episode.parent_entity_id = rv.entity_id
		AND podcast_episode.episode_number = rv.podcast_extra_information ->> 'episode'
	LEFT JOIN _legacy_show_episode_coordinates show_coordinate
		ON e.entity_schema_slug = 'show'
		AND show_coordinate.parent_entity_id = rv.entity_id
		AND show_coordinate.season_number = rv.show_extra_information ->> 'season'
		AND show_coordinate.episode_number = rv.show_extra_information ->> 'episode'
	LEFT JOIN _legacy_podcast_episode_coordinates podcast_coordinate
		ON e.entity_schema_slug = 'podcast'
		AND podcast_coordinate.parent_entity_id = rv.entity_id
		AND podcast_coordinate.episode_number = rv.podcast_extra_information ->> 'episode'
	LEFT JOIN _legacy_episodic_inventory inventory ON inventory.parent_entity_id = e.id
	WHERE (
			e.entity_schema_slug = 'show'
			AND (rv.show_extra_information ->> 'season') ~ '^[0-9]+$'
			AND (rv.show_extra_information ->> 'episode') ~ '^[0-9]+$'
			AND show_episode.entity_id IS NULL
		)
		OR (
			e.entity_schema_slug = 'podcast'
			AND (rv.podcast_extra_information ->> 'episode') ~ '^[0-9]+$'
			AND podcast_episode.entity_id IS NULL
		);

	${buildAnomalyReportSql({
		phase: reviewReportPhase,
		seqVariable: "report_seq",
		code: "review-episode-absent",
		detail: reviewAbsentDetailSql,
		countVariable: "unresolved_absent_rows",
		source: "_review_unresolved_positions u WHERE u.cause = 'absent'",
		message:
			"Some reviews were not carried over because the episode they were written about does not exist in the show or podcast's stored episode list. Each skipped review is listed below with what the stored list actually contains.",
	})}

	${buildAnomalyReportSql({
		phase: reviewReportPhase,
		seqVariable: "report_seq",
		code: "review-episode-ambiguous",
		detail: reviewAmbiguousDetailSql,
		countVariable: "unresolved_ambiguous_rows",
		source: "_review_unresolved_positions u WHERE u.cause = 'ambiguous'",
		message:
			"Some reviews were not carried over because more than one stored episode claims the position they were written about, so there was no way to tell which episode was reviewed.",
	})}

	${buildReportSql("review -> event", [{ count: "rows_inserted", message: "row(s) migrated total" }])}
END $$;
`;
