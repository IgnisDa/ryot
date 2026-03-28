import { sql } from "drizzle-orm";

import type { DbClient } from "~/lib/db";

import {
	type LotEntityMigrationTarget,
	type ResolvedLotEntityMigrationTarget,
	type ResolvedRelationshipTarget,
	buildLotEntityTargetValuesSql,
	buildPrimaryImageSql,
	buildRelationshipTargetValuesSql,
} from "./shared";

type MetadataGroupRelationshipTarget = {
	lot: string;
	relationshipSchemaSlug: string;
};

// Lots without a V2 group entity schema (anime, manga, show, podcast, visual_novel) are
// intentionally omitted here and will be skipped via the INNER JOIN in the migration SQL.
export const metadataGroupEntityTargets = [
	{
		lot: "audio_book",
		source: "audible",
		entitySchemaSlug: "audiobook-group",
		sandboxScriptSlug: "audiobook-group.audible",
	},
	{
		lot: "audio_book",
		source: "custom",
		entitySchemaSlug: "audiobook-group",
		sandboxScriptSlug: null,
	},
	{ lot: "book", source: "custom", entitySchemaSlug: "book-group", sandboxScriptSlug: null },
	{ lot: "book", source: "google_books", entitySchemaSlug: "book-group", sandboxScriptSlug: null },
	{
		lot: "book",
		source: "hardcover",
		entitySchemaSlug: "book-group",
		sandboxScriptSlug: "book-group.hardcover",
	},
	{ lot: "book", source: "openlibrary", entitySchemaSlug: "book-group", sandboxScriptSlug: null },
	{
		lot: "comic_book",
		source: "custom",
		entitySchemaSlug: "comic-book-group",
		sandboxScriptSlug: null,
	},
	{
		lot: "comic_book",
		source: "metron",
		entitySchemaSlug: "comic-book-group",
		sandboxScriptSlug: "comic-book-group.metron",
	},
	{ lot: "movie", source: "custom", entitySchemaSlug: "movie-group", sandboxScriptSlug: null },
	{
		lot: "movie",
		source: "tmdb",
		entitySchemaSlug: "movie-group",
		sandboxScriptSlug: "movie-group.tmdb",
	},
	{
		lot: "movie",
		source: "tvdb",
		entitySchemaSlug: "movie-group",
		sandboxScriptSlug: "movie-group.tvdb",
	},
	{ lot: "music", source: "custom", entitySchemaSlug: "music-group", sandboxScriptSlug: null },
	{
		lot: "music",
		source: "music_brainz",
		entitySchemaSlug: "music-group",
		sandboxScriptSlug: "music-group.musicbrainz",
	},
	{
		lot: "music",
		source: "spotify",
		entitySchemaSlug: "music-group",
		sandboxScriptSlug: "music-group.spotify",
	},
	{
		lot: "music",
		source: "youtube_music",
		entitySchemaSlug: "music-group",
		sandboxScriptSlug: "music-group.youtube-music",
	},
	{
		lot: "video_game",
		source: "custom",
		entitySchemaSlug: "video-game-group",
		sandboxScriptSlug: null,
	},
	{
		lot: "video_game",
		source: "giant_bomb",
		entitySchemaSlug: "video-game-group",
		sandboxScriptSlug: "video-game-group.giant-bomb",
	},
	{
		lot: "video_game",
		source: "igdb",
		entitySchemaSlug: "video-game-group",
		sandboxScriptSlug: "video-game-group.igdb",
	},
] as const satisfies readonly LotEntityMigrationTarget[];

export const metadataGroupRelationshipTargets = [
	{ lot: "audio_book", relationshipSchemaSlug: "audiobook-group-to-audiobook" },
	{ lot: "book", relationshipSchemaSlug: "book-group-to-book" },
	{ lot: "comic_book", relationshipSchemaSlug: "comic-book-group-to-comic-book" },
	{ lot: "movie", relationshipSchemaSlug: "movie-group-to-movie" },
	{ lot: "music", relationshipSchemaSlug: "music-group-to-music" },
	{ lot: "video_game", relationshipSchemaSlug: "video-game-group-to-video-game" },
] as const satisfies readonly MetadataGroupRelationshipTarget[];

const supportedGroupLots = [...new Set(metadataGroupEntityTargets.map((t) => t.lot))];

const metadataGroupEntityTargetValuesSql = sql.join(
	metadataGroupEntityTargets.map(
		(t) => sql`(${t.lot}, ${t.source}, ${t.entitySchemaSlug}, ${t.sandboxScriptSlug})`,
	),
	sql`, `,
);

export const buildMetadataGroupEntityMigrationSql = (
	targets: ResolvedLotEntityMigrationTarget[],
) => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	RAISE NOTICE 'metadata_group -> entity: migration started (% seconds elapsed)', 0.0;

	LOOP
		WITH metadata_group_targets (lot, source, entity_schema_id, sandbox_script_id) AS (
			VALUES ${buildLotEntityTargetValuesSql(targets)}
		), batch AS (
			SELECT mg.id::text AS id
			FROM "metadata_group" mg
			INNER JOIN metadata_group_targets mgt ON mgt.lot = mg.lot AND mgt.source = mg.source
			WHERE mg.id::text > cursor_id
			ORDER BY mg.id::text
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		WITH metadata_group_targets (lot, source, entity_schema_id, sandbox_script_id) AS (
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
			mg.id,
			mg.identifier,
			mg.title,
			${buildPrimaryImageSql("mg")},
			mg.last_updated_on,
			NULL,
			NULL,
			'{}'::jsonb,
			mgt.entity_schema_id,
			mgt.sandbox_script_id,
			mg.last_updated_on
		FROM "metadata_group" mg
		INNER JOIN metadata_group_targets mgt ON mgt.lot = mg.lot AND mgt.source = mg.source
		WHERE mg.id::text > cursor_id AND mg.id::text <= next_cursor_id
		ON CONFLICT ("id") DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
		RAISE NOTICE 'metadata_group -> entity: % row(s) migrated so far (% seconds elapsed)',
			rows_inserted,
			round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
	END LOOP;

	RAISE NOTICE 'metadata_group -> entity: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

export const buildMetadataGroupRelationshipMigrationSql = (
	targets: ResolvedRelationshipTarget[],
) => `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	RAISE NOTICE 'metadata_group -> relationship: migration started (% seconds elapsed)', 0.0;

	LOOP
		WITH lot_to_relationship_schema (lot, relationship_schema_id) AS (
			VALUES ${buildRelationshipTargetValuesSql(targets)}
		), batch AS (
			SELECT DISTINCT m2mg.metadata_id::text AS id
			FROM "metadata_to_metadata_group" m2mg
			INNER JOIN "metadata_group" mg ON mg.id = m2mg.metadata_group_id
			INNER JOIN lot_to_relationship_schema lrs ON lrs.lot = mg.lot
			WHERE m2mg.metadata_id::text > cursor_id
			ORDER BY m2mg.metadata_id::text
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		WITH lot_to_relationship_schema (lot, relationship_schema_id) AS (
			VALUES ${buildRelationshipTargetValuesSql(targets)}
		)
		INSERT INTO relationship (
			"id",
			"source_entity_id",
			"target_entity_id",
			"relationship_schema_id",
			"properties",
			"user_id",
			"created_at"
		)
		SELECT
			gen_random_uuid()::text,
			m2mg.metadata_group_id,
			m2mg.metadata_id,
			lrs.relationship_schema_id,
			'{}'::jsonb,
			NULL,
			NOW()
		FROM "metadata_to_metadata_group" m2mg
		INNER JOIN "metadata_group" mg ON mg.id = m2mg.metadata_group_id
		INNER JOIN lot_to_relationship_schema lrs ON lrs.lot = mg.lot
		WHERE m2mg.metadata_id::text > cursor_id AND m2mg.metadata_id::text <= next_cursor_id
		ON CONFLICT (source_entity_id, target_entity_id, relationship_schema_id) WHERE user_id IS NULL DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
		RAISE NOTICE 'metadata_group -> relationship: % row(s) migrated so far (% seconds elapsed)',
			rows_inserted,
			round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
	END LOOP;

	RAISE NOTICE 'metadata_group -> relationship: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

// Only checks for unsupported source values within lots that DO have V2 group schemas.
// Lots without a V2 group schema (anime, manga, show, podcast, visual_novel) are silently skipped.
export const getUnsupportedMetadataGroupSources = async (database: DbClient) => {
	const result = await database.execute<{ lot: string; source: string }>(sql`
		WITH metadata_group_targets (lot, source, entity_schema_slug, sandbox_script_slug) AS (
			VALUES ${metadataGroupEntityTargetValuesSql}
		),
		supported_lots (lot) AS (
			VALUES ${sql.join(
				supportedGroupLots.map((lot) => sql`(${lot})`),
				sql`, `,
			)}
		)
		SELECT DISTINCT
			mg.lot AS lot,
			mg.source AS source
		FROM "metadata_group" mg
		INNER JOIN supported_lots sl ON sl.lot = mg.lot
		LEFT JOIN metadata_group_targets mgt ON mgt.lot = mg.lot AND mgt.source = mg.source
		WHERE mgt.lot IS NULL
		ORDER BY mg.lot, mg.source
	`);

	return result.rows;
};
