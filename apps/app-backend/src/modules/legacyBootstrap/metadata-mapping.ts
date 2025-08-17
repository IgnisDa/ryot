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

export const buildMetadataMigrationSql = (targets: ResolvedLotEntityMigrationTarget[]) => `
DO $$
DECLARE rows_inserted int;
BEGIN
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
		NULL,
		'{}'::jsonb,
		metadata_targets.entity_schema_id,
		metadata_targets.sandbox_script_id,
		metadata.last_updated_on
	FROM metadata
	INNER JOIN metadata_targets ON metadata_targets.lot = metadata.lot AND metadata_targets.source = metadata.source
	ON CONFLICT ("id") DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE 'metadata -> entity: % row(s) migrated', rows_inserted;
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
