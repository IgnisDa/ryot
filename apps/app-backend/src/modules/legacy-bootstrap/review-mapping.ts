// Dropped fields:
// - visibility: V2 events have no visibility concept; public/private distinction is lost.
// - comments: V2 has no comments concept on events; comment threads are lost.
//
// V1 review.entity_id is a generated column — COALESCE of the 5 nullable entity FK columns —
// and equals the V2 entity.id directly because all entity migrations preserve legacy IDs.
//
// Reviews for metadata_group entities whose lot has no V2 entity schema (anime, manga, show,
// podcast, visual_novel groups) are silently skipped via INNER JOIN: those entities were never
// inserted into the entity table so the join produces no row.
//
// V1 Decimal (manga chapter) is serialized by rust_decimal's default serde as a JSON string;
// the ->> operator extracts it as text before the ::float8 cast handles both string and
// numeric JSONB representations safely.
//
// V1 rating had no upper bound; V2 enforces maximum: 100. Ratings above 100 are clamped to 100.
export const buildReviewMigrationSql = () => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"review"') IS NULL THEN
		RAISE EXCEPTION 'Expected review table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'review -> event: migration started (% seconds elapsed)', 0.0;

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
			"created_at"
		)
		SELECT
			r.id,
			r.user_id,
			r.entity_id,
			es.id,
			jsonb_strip_nulls(jsonb_build_object(
				'rating',         LEAST(r.rating, 100),
				'text',           NULLIF(r.text, ''),
				'isSpoiler',      r.is_spoiler,
				'showSeason',     (r.show_extra_information ->> 'season')::int,
				'showEpisode',    (r.show_extra_information ->> 'episode')::int,
				'animeEpisode',   (r.anime_extra_information ->> 'episode')::int,
				'mangaVolume',    (r.manga_extra_information ->> 'volume')::int,
				'mangaChapter',   NULLIF(r.manga_extra_information ->> 'chapter', '')::float8,
				'podcastEpisode', (r.podcast_extra_information ->> 'episode')::int
			)),
			r.posted_on
		FROM "review" r
		INNER JOIN "entity" e ON e.id = r.entity_id
		INNER JOIN "event_schema" es
			ON es.entity_schema_id = e.entity_schema_id
			AND es.slug = 'review'
			AND es.user_id IS NULL
		WHERE r.id > cursor_id
		  AND r.id <= next_cursor_id
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
		RAISE NOTICE 'review -> event: % row(s) migrated so far (% seconds elapsed)',
			rows_inserted,
			round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
	END LOOP;

	RAISE NOTICE 'review -> event: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
