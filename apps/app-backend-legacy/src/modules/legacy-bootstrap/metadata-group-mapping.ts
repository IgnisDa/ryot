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

const buildMetadataGroupPropertiesSql = (
	tableAlias: string,
) => `jsonb_strip_nulls(jsonb_build_object(
	'parts', ${tableAlias}.parts,
	'images', ${buildLegacyImageArraySql(tableAlias)},
	'description', ${tableAlias}.description,
	'sourceUrl', ${tableAlias}.source_url
))`;

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
			mg.created_by_user_id,
			${buildMetadataGroupPropertiesSql("mg")},
			mgt.entity_schema_id,
			mgt.sandbox_script_id,
			mg.last_updated_on
		FROM "metadata_group" mg
		INNER JOIN metadata_group_targets mgt ON mgt.lot = mg.lot AND mgt.source = mg.source
		WHERE mg.id::text > cursor_id AND mg.id::text <= next_cursor_id
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

	IF EXISTS (
		WITH lot_to_relationship_schema (lot, relationship_schema_id) AS (
			VALUES ${buildRelationshipTargetValuesSql(targets)}
		)
		SELECT 1
		FROM "metadata_to_metadata_group" m2mg
		INNER JOIN "metadata_group" mg ON mg.id = m2mg.metadata_group_id
		INNER JOIN "metadata" metadata ON metadata.id = m2mg.metadata_id
		INNER JOIN lot_to_relationship_schema lrs ON lrs.lot = mg.lot
		WHERE mg.created_by_user_id IS NOT NULL
			AND metadata.created_by_user_id IS NOT NULL
			AND mg.created_by_user_id <> metadata.created_by_user_id
		LIMIT 1
	) THEN
		RAISE EXCEPTION 'metadata_group -> relationship: found relationship between entities owned by different users';
	END IF;

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
		), legacy_relationships AS (
			SELECT
				m2mg.part,
				m2mg.metadata_id,
				m2mg.metadata_group_id,
				lrs.relationship_schema_id,
				CASE
					WHEN mg.created_by_user_id IS NULL THEN metadata.created_by_user_id
					WHEN metadata.created_by_user_id IS NULL THEN mg.created_by_user_id
					WHEN mg.created_by_user_id = metadata.created_by_user_id THEN mg.created_by_user_id
				END AS user_id
			FROM "metadata_to_metadata_group" m2mg
			INNER JOIN "metadata_group" mg ON mg.id = m2mg.metadata_group_id
			INNER JOIN "metadata" metadata ON metadata.id = m2mg.metadata_id
			INNER JOIN lot_to_relationship_schema lrs ON lrs.lot = mg.lot
			WHERE m2mg.metadata_id::text > cursor_id AND m2mg.metadata_id::text <= next_cursor_id
		), stale_global_relationships_deleted AS (
			DELETE FROM relationship stale_relationship
			USING legacy_relationships
			WHERE legacy_relationships.user_id IS NOT NULL
				AND stale_relationship.user_id IS NULL
				AND stale_relationship.source_entity_id = legacy_relationships.metadata_group_id
				AND stale_relationship.target_entity_id = legacy_relationships.metadata_id
				AND stale_relationship.relationship_schema_id = legacy_relationships.relationship_schema_id
			RETURNING stale_relationship.id
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
			legacy_relationships.metadata_group_id,
			legacy_relationships.metadata_id,
			legacy_relationships.relationship_schema_id,
			CASE
				WHEN legacy_relationships.part IS NULL THEN '{}'::jsonb
				WHEN legacy_relationships.part <= 0 THEN jsonb_build_object('order', 1)
				ELSE jsonb_build_object('order', legacy_relationships.part)
			END,
			legacy_relationships.user_id,
			NOW()
		FROM legacy_relationships
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
	END LOOP;

	RAISE NOTICE 'metadata_group -> relationship: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

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
