import { sql } from "drizzle-orm";

import type { DbClient } from "~/lib/db";

import {
	type LotEntityMigrationTarget,
	type ResolvedLotEntityMigrationTarget,
	buildLotEntityTargetValuesSql,
	buildPrimaryImageSql,
} from "./shared";

export const metadataMigrationTargets = [
	{
		lot: "audio_book",
		source: "audible",
		entitySchemaSlug: "audiobook",
		sandboxScriptSlug: "audiobook.audible",
	},
	{ lot: "audio_book", source: "custom", entitySchemaSlug: "audiobook", sandboxScriptSlug: null },
	{
		lot: "anime",
		source: "anilist",
		entitySchemaSlug: "anime",
		sandboxScriptSlug: "anime.anilist",
	},
	{ lot: "anime", source: "custom", entitySchemaSlug: "anime", sandboxScriptSlug: null },
	{
		lot: "anime",
		source: "myanimelist",
		entitySchemaSlug: "anime",
		sandboxScriptSlug: "anime.myanimelist",
	},
	{ lot: "book", source: "custom", entitySchemaSlug: "book", sandboxScriptSlug: null },
	{
		lot: "book",
		source: "google_books",
		entitySchemaSlug: "book",
		sandboxScriptSlug: "book.google-book",
	},
	{
		lot: "book",
		source: "hardcover",
		entitySchemaSlug: "book",
		sandboxScriptSlug: "book.hardcover",
	},
	{
		lot: "book",
		source: "openlibrary",
		entitySchemaSlug: "book",
		sandboxScriptSlug: "book.openlibrary",
	},
	{ lot: "comic_book", source: "custom", entitySchemaSlug: "comic-book", sandboxScriptSlug: null },
	{
		lot: "comic_book",
		source: "metron",
		entitySchemaSlug: "comic-book",
		sandboxScriptSlug: "comic-book.metron",
	},
	{
		lot: "manga",
		source: "anilist",
		entitySchemaSlug: "manga",
		sandboxScriptSlug: "manga.anilist",
	},
	{ lot: "manga", source: "custom", entitySchemaSlug: "manga", sandboxScriptSlug: null },
	{
		lot: "manga",
		source: "manga_updates",
		entitySchemaSlug: "manga",
		sandboxScriptSlug: "manga.manga-updates",
	},
	{
		lot: "manga",
		source: "myanimelist",
		entitySchemaSlug: "manga",
		sandboxScriptSlug: "manga.myanimelist",
	},
	{ lot: "movie", source: "custom", entitySchemaSlug: "movie", sandboxScriptSlug: null },
	{ lot: "movie", source: "tmdb", entitySchemaSlug: "movie", sandboxScriptSlug: "movie.tmdb" },
	{ lot: "movie", source: "tvdb", entitySchemaSlug: "movie", sandboxScriptSlug: "movie.tvdb" },
	{ lot: "music", source: "custom", entitySchemaSlug: "music", sandboxScriptSlug: null },
	{
		lot: "music",
		source: "music_brainz",
		entitySchemaSlug: "music",
		sandboxScriptSlug: "music.musicbrainz",
	},
	{
		lot: "music",
		source: "spotify",
		entitySchemaSlug: "music",
		sandboxScriptSlug: "music.spotify",
	},
	{
		lot: "music",
		source: "youtube_music",
		entitySchemaSlug: "music",
		sandboxScriptSlug: "music.youtube-music",
	},
	{ lot: "podcast", source: "custom", entitySchemaSlug: "podcast", sandboxScriptSlug: null },
	{
		lot: "podcast",
		source: "itunes",
		entitySchemaSlug: "podcast",
		sandboxScriptSlug: "podcast.itunes",
	},
	{
		lot: "podcast",
		source: "listennotes",
		entitySchemaSlug: "podcast",
		sandboxScriptSlug: "podcast.listennotes",
	},
	{ lot: "show", source: "custom", entitySchemaSlug: "show", sandboxScriptSlug: null },
	{ lot: "show", source: "tmdb", entitySchemaSlug: "show", sandboxScriptSlug: "show.tmdb" },
	{ lot: "show", source: "tvdb", entitySchemaSlug: "show", sandboxScriptSlug: "show.tvdb" },
	{ lot: "video_game", source: "custom", entitySchemaSlug: "video-game", sandboxScriptSlug: null },
	{
		lot: "video_game",
		source: "giant_bomb",
		entitySchemaSlug: "video-game",
		sandboxScriptSlug: "video-game.giant-bomb",
	},
	{
		lot: "video_game",
		source: "igdb",
		entitySchemaSlug: "video-game",
		sandboxScriptSlug: "video-game.igdb",
	},
	{
		lot: "visual_novel",
		source: "custom",
		entitySchemaSlug: "visual-novel",
		sandboxScriptSlug: null,
	},
	{
		lot: "visual_novel",
		source: "vndb",
		entitySchemaSlug: "visual-novel",
		sandboxScriptSlug: "visual-novel.vndb",
	},
] as const satisfies readonly LotEntityMigrationTarget[];

const metadataMigrationTargetValuesSql = sql.join(
	metadataMigrationTargets.map(
		(target) =>
			sql`(${target.lot}, ${target.source}, ${target.entitySchemaSlug}, ${target.sandboxScriptSlug})`,
	),
	sql`, `,
);

const buildLegacyImageArraySql = (tableAlias: string) => `(
	COALESCE(
		(
			SELECT jsonb_agg(
				jsonb_build_object('type', 'remote', 'url', remote_image)
				ORDER BY ordinality
			)
			FROM jsonb_array_elements_text(COALESCE(${tableAlias}.assets -> 'remote_images', '[]'::jsonb))
				WITH ORDINALITY AS remote(remote_image, ordinality)
		),
		'[]'::jsonb
	)
	||
	COALESCE(
		(
			SELECT jsonb_agg(
				jsonb_build_object('type', 's3', 'key', s3_image)
				ORDER BY ordinality
			)
			FROM jsonb_array_elements_text(COALESCE(${tableAlias}.assets -> 's3_images', '[]'::jsonb))
				WITH ORDINALITY AS s3(s3_image, ordinality)
		),
		'[]'::jsonb
	)
)`;

const buildMetadataCommonPropertiesSql = () => `
COALESCE(
	jsonb_strip_nulls(jsonb_build_object(
		'images', ${buildLegacyImageArraySql("metadata")},
		'genres', COALESCE((
			SELECT jsonb_agg(genre.name ORDER BY genre.name)
			FROM metadata_to_genre metadata_genre
			INNER JOIN genre ON genre.id = metadata_genre.genre_id
			WHERE metadata_genre.metadata_id = metadata.id
		), '[]'::jsonb),
		'publishYear', metadata.publish_year,
		'isNsfw', metadata.is_nsfw,
		'publishDate', to_char(metadata.publish_date, 'YYYY-MM-DD'),
		'sourceUrl', metadata.source_url,
		'description', metadata.description,
		'providerRating', metadata.provider_rating,
		'productionStatus', metadata.production_status
	)),
	'{}'::jsonb
)
`;

// Non-obvious V1→V2 field transformations applied in the lot-specific CASE branches below:
//
// audio_book / book / podcast: V1 `free_creators` (Vec<{name, role}>) → V2 `unlinkedCreators`.
//   Always emitted as COALESCE(free_creators, '[]') so the required array key is always present.
//
// book: V1 `book_specifics.is_compilation` renamed to V2 `isCompilation`.
//
// music: V1 `music_specifics.by_various_artists` renamed to V2 `byVariousArtists`.
//
// video_game: V1 `video_game_specifics.time_to_beat.*` values are in seconds (from IGDB);
//   V2 `timeToBeat.*` stores minutes — divide by 60 and round.
//   V1 `platform_releases[].release_date` / `release_region` renamed to camelCase
//   `releaseDate` / `releaseRegion`.
//
// visual_novel: V1 `visual_novel_specifics.length` (already in minutes from VNDB) renamed to
//   V2 `lengthMinutes` — no unit conversion.
//
// comic_book: V1 `comic_book_specifics.page_count` renamed to V2 `pages`.
const buildMetadataLotSpecificPropertiesSql = () => `
COALESCE(jsonb_strip_nulls(
	CASE
		WHEN metadata.lot = 'show' THEN jsonb_build_object(
			'showSeasons', COALESCE((
				SELECT jsonb_agg(
					jsonb_strip_nulls(jsonb_build_object(
						'id',             (season.value ->> 'id')::int,
						'name',           season.value ->> 'name',
						'overview',       season.value ->> 'overview',
						'episodes',       COALESCE((
							SELECT jsonb_agg(
								jsonb_strip_nulls(jsonb_build_object(
									'id',            (episode.value ->> 'id')::int,
									'name',          episode.value ->> 'name',
									'runtime',       (episode.value ->> 'runtime')::int,
									'overview',      episode.value ->> 'overview',
									'publishDate',   episode.value ->> 'publish_date',
									'posterImages',  COALESCE(episode.value -> 'poster_images', '[]'::jsonb),
									'episodeNumber', (episode.value ->> 'episode_number')::int
								))
								ORDER BY (episode.value ->> 'episode_number')::int
							)
							FROM jsonb_array_elements(
								CASE
									WHEN jsonb_typeof(season.value -> 'episodes') = 'array'
									THEN season.value -> 'episodes'
									ELSE '[]'::jsonb
								END
							) AS episode(value)
						), '[]'::jsonb),
						'publishDate',     season.value ->> 'publish_date',
						'posterImages',    COALESCE(season.value -> 'poster_images', '[]'::jsonb),
						'seasonNumber',    (season.value ->> 'season_number')::int,
						'backdropImages',  COALESCE(season.value -> 'backdrop_images', '[]'::jsonb)
					))
					ORDER BY (season.value ->> 'season_number')::int
				)
				FROM jsonb_array_elements(
					CASE
						WHEN jsonb_typeof(metadata.show_specifics -> 'seasons') = 'array'
						THEN metadata.show_specifics -> 'seasons'
						ELSE '[]'::jsonb
					END
				) AS season(value)
			), '[]'::jsonb)
		)
		WHEN metadata.lot = 'anime' THEN jsonb_build_object(
			'episodes', (metadata.anime_specifics ->> 'episodes')::int
		)
		WHEN metadata.lot = 'manga' THEN jsonb_build_object(
			'volumes',  (metadata.manga_specifics ->> 'volumes')::int,
			'chapters', NULLIF(metadata.manga_specifics ->> 'chapters', '')::float8
		)
		WHEN metadata.lot = 'podcast' THEN jsonb_build_object(
			'episodes', COALESCE((
				SELECT jsonb_agg(
					jsonb_strip_nulls(jsonb_build_object(
						'id',          episode.value ->> 'id',
						'title',       episode.value ->> 'title',
						'number',      (episode.value ->> 'number')::int,
						'runtime',     (episode.value ->> 'runtime')::int,
						'overview',    episode.value ->> 'overview',
						'thumbnail',   episode.value ->> 'thumbnail',
						'publishDate', episode.value ->> 'publish_date'
					))
					ORDER BY (episode.value ->> 'number')::int
				)
				FROM jsonb_array_elements(
					CASE
						WHEN jsonb_typeof(metadata.podcast_specifics -> 'episodes') = 'array'
						THEN metadata.podcast_specifics -> 'episodes'
						ELSE '[]'::jsonb
					END
				) AS episode(value)
			), '[]'::jsonb),
			'totalEpisodes',    (metadata.podcast_specifics ->> 'total_episodes')::int,
			'unlinkedCreators', COALESCE(metadata.free_creators, '[]'::jsonb)
		)
		WHEN metadata.lot = 'audio_book' THEN jsonb_build_object(
			'runtime',          (metadata.audio_book_specifics ->> 'runtime')::int,
			'unlinkedCreators', COALESCE(metadata.free_creators, '[]'::jsonb)
		)
		WHEN metadata.lot = 'book' THEN jsonb_build_object(
			'pages',            (metadata.book_specifics ->> 'pages')::int,
			'isCompilation',    (metadata.book_specifics ->> 'is_compilation')::boolean,
			'unlinkedCreators', COALESCE(metadata.free_creators, '[]'::jsonb)
		)
		WHEN metadata.lot = 'movie' THEN jsonb_build_object(
			'runtime', (metadata.movie_specifics ->> 'runtime')::int
		)
		WHEN metadata.lot = 'music' THEN jsonb_build_object(
			'duration',         (metadata.music_specifics ->> 'duration')::int,
			'byVariousArtists', (metadata.music_specifics ->> 'by_various_artists')::boolean
		)
		WHEN metadata.lot = 'video_game' THEN jsonb_build_object(
			'timeToBeat', CASE
				WHEN metadata.video_game_specifics -> 'time_to_beat' IS NOT NULL
				THEN jsonb_build_object(
					'hastily',    ROUND((metadata.video_game_specifics -> 'time_to_beat' ->> 'hastily')::float8 / 60)::int,
					'normally',   ROUND((metadata.video_game_specifics -> 'time_to_beat' ->> 'normally')::float8 / 60)::int,
					'completely', ROUND((metadata.video_game_specifics -> 'time_to_beat' ->> 'completely')::float8 / 60)::int
				)
				ELSE NULL
			END,
			'platformReleases', COALESCE(
				(
					SELECT jsonb_agg(
						jsonb_strip_nulls(jsonb_build_object(
							'name',          pr ->> 'name',
							'releaseDate',   pr ->> 'release_date',
							'releaseRegion', pr ->> 'release_region'
						))
					)
					FROM jsonb_array_elements(
						COALESCE(metadata.video_game_specifics -> 'platform_releases', '[]'::jsonb)
					) AS pr
				),
				'[]'::jsonb
			)
		)
		WHEN metadata.lot = 'visual_novel' THEN jsonb_build_object(
			'lengthMinutes', (metadata.visual_novel_specifics ->> 'length')::int
		)
		WHEN metadata.lot = 'comic_book' THEN jsonb_build_object(
			'pages', (metadata.comic_book_specifics ->> 'page_count')::int
		)
	END
), '{}'::jsonb)
`;

export const buildMetadataPropertiesSql = () => `
(
	${buildMetadataCommonPropertiesSql()}
	||
	${buildMetadataLotSpecificPropertiesSql()}
)
`;

export const buildMetadataMigrationSql = (targets: ResolvedLotEntityMigrationTarget[]) => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	RAISE NOTICE 'metadata -> entity: migration started (% seconds elapsed)', 0.0;

	LOOP
		WITH metadata_targets (lot, source, entity_schema_id, sandbox_script_id) AS (
			VALUES ${buildLotEntityTargetValuesSql(targets)}
		), batch AS (
			SELECT metadata.id::text AS id
			FROM metadata
			INNER JOIN metadata_targets ON metadata_targets.lot = metadata.lot AND metadata_targets.source = metadata.source
			WHERE metadata.id::text > cursor_id
			ORDER BY metadata.id::text
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		WITH metadata_targets (lot, source, entity_schema_id, sandbox_script_id) AS (
			VALUES ${buildLotEntityTargetValuesSql(targets)}
		)
		INSERT INTO entity (
			"id",
			"external_id",
			"name",
			"image",
			"created_at",
			"populated_at",
			"user_id",
			"properties",
			"entity_schema_id",
			"sandbox_script_id",
			"updated_at"
		)
		SELECT
			metadata.id,
			metadata.identifier,
			metadata.title,
			${buildPrimaryImageSql("metadata")},
			metadata.created_on,
			NULL,
			metadata.created_by_user_id,
			${buildMetadataPropertiesSql()},
			metadata_targets.entity_schema_id,
			metadata_targets.sandbox_script_id,
			metadata.last_updated_on
		FROM metadata
		INNER JOIN metadata_targets ON metadata_targets.lot = metadata.lot AND metadata_targets.source = metadata.source
		WHERE metadata.id::text > cursor_id AND metadata.id::text <= next_cursor_id
		ON CONFLICT ("id") DO UPDATE
			SET
				"properties" = CASE
					WHEN entity."properties" = '{}'::jsonb THEN EXCLUDED."properties"
					ELSE entity."properties"
				END,
				"user_id" = COALESCE(entity."user_id", EXCLUDED."user_id")
			WHERE entity."properties" = '{}'::jsonb OR entity."user_id" IS NULL;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
	END LOOP;

	RAISE NOTICE 'metadata -> entity: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

export const getUnsupportedMetadataSources = async (database: DbClient) => {
	const result = await database.execute<{ lot: string; source: string }>(sql`
		WITH metadata_targets (lot, source, entity_schema_slug, sandbox_script_slug) AS (
			VALUES ${metadataMigrationTargetValuesSql}
		)
		SELECT DISTINCT
			metadata.lot AS lot,
			metadata.source AS source
		FROM metadata
		LEFT JOIN metadata_targets ON metadata_targets.lot = metadata.lot AND metadata_targets.source = metadata.source
		WHERE metadata_targets.lot IS NULL
		ORDER BY metadata.lot, metadata.source
	`);

	return result.rows;
};
