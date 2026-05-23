import { and, eq, isNull, sql } from "drizzle-orm";

import type { DbClient } from "~/lib/db";
import { entitySchema, sandboxScript } from "~/lib/db/schema";

type MetadataMigrationTarget = {
	lot: string;
	source: string;
	entitySchemaSlug: string;
	sandboxScriptSlug: string | null;
};

type ResolvedMetadataMigrationTarget = {
	lot: string;
	source: string;
	entitySchemaId: string;
	sandboxScriptId: string | null;
};

const metadataMigrationTargets = [
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
] as const satisfies readonly MetadataMigrationTarget[];

const metadataMigrationTargetValuesSql = sql.join(
	metadataMigrationTargets.map(
		(target) =>
			sql`(${target.lot}, ${target.source}, ${target.entitySchemaSlug}, ${target.sandboxScriptSlug})`,
	),
	sql`, `,
);

const buildMetadataMigrationTargetValuesSql = (targets: ResolvedMetadataMigrationTarget[]) =>
	sql.join(
		targets.map(
			(target) =>
				sql`(${target.lot}, ${target.source}, ${target.entitySchemaId}, ${target.sandboxScriptId})`,
		),
		sql`, `,
	);

const buildUniqueSlugMap = (
	rows: Array<{ id: string; slug: string }>,
	kind: string,
): Map<string, string> => {
	const idsBySlug = new Map<string, string>();
	const duplicateSlugs = new Set<string>();

	for (const row of rows) {
		if (idsBySlug.has(row.slug)) {
			duplicateSlugs.add(row.slug);
		}
		idsBySlug.set(row.slug, row.id);
	}

	if (duplicateSlugs.size > 0) {
		throw new Error(`Duplicate ${kind} slugs: ${Array.from(duplicateSlugs).join(", ")}`);
	}

	return idsBySlug;
};

const renameLegacyTablesSql = sql`
DO $$
BEGIN
	IF to_regclass('public.old_user') IS NULL
		AND EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public'
				AND table_name = 'user'
				AND column_name = 'lot'
		)
	THEN
		ALTER TABLE "user" RENAME TO old_user;
		ALTER TABLE "old_user" RENAME CONSTRAINT "user_pkey" TO "old_user_pkey";
		ALTER INDEX IF EXISTS "user__oidc_issuer_id__index" RENAME TO "old_user__oidc_issuer_id__index";
		ALTER INDEX IF EXISTS "user_is_disabled_idx" RENAME TO "old_user_is_disabled_idx";
		ALTER INDEX IF EXISTS "user_name_trigram_idx" RENAME TO "old_user_name_trigram_idx";
	END IF;
END $$;
`;

export const renameLegacyTables = async (database: DbClient) => {
	await database.execute(renameLegacyTablesSql);
};

const migrateUserTableSql = sql`
DO $$
BEGIN
	IF to_regclass('public.old_user') IS NULL THEN
		RETURN;
	END IF;

	WITH legacy_users AS (
		SELECT
			old_user.id,
			old_user.name,
			old_user.preferences,
			old_user.created_on,
			old_user.last_login_on,
			nullif(regexp_replace(lower(old_user.name), '[^a-z0-9._%+-]+', '', 'g'), '') AS email_local_part,
			count(*) OVER (
				PARTITION BY nullif(regexp_replace(lower(old_user.name), '[^a-z0-9._%+-]+', '', 'g'), '')
			) AS email_local_part_count
		FROM old_user
	)
	INSERT INTO "user" (
		"id",
		"name",
		"email",
		"preferences",
		"email_verified",
		"created_at",
		"updated_at"
	)
	SELECT
		legacy_users.id,
		legacy_users.name,
		CASE
			WHEN legacy_users.email_local_part_count > 1 AND legacy_users.email_local_part IS NOT NULL THEN
				legacy_users.email_local_part || '+' || legacy_users.id || '@ryot.local'
			ELSE
				COALESCE(legacy_users.email_local_part, legacy_users.id) || '@ryot.local'
		END,
		jsonb_build_object(
			'isNsfw', COALESCE((legacy_users.preferences -> 'general' ->> 'display_nsfw')::boolean, false),
			'languages', jsonb_build_object(
				'providers', COALESCE(
					(
						SELECT jsonb_agg(
							jsonb_build_object(
								'source', provider.value ->> 'source',
								'preferredLanguage', provider.value ->> 'preferred_language'
							)
							ORDER BY provider.ordinality
						)
						FROM jsonb_array_elements(
							COALESCE(legacy_users.preferences -> 'languages' -> 'providers', '[]'::jsonb)
						) WITH ORDINALITY AS provider(value, ordinality)
					),
					'[]'::jsonb
				)
			)
		),
		true,
		legacy_users.created_on,
		COALESCE(legacy_users.last_login_on, legacy_users.created_on)
	FROM legacy_users
	ON CONFLICT ("id") DO NOTHING;
END $$;
`;

const buildMetadataMigrationSql = (targets: ResolvedMetadataMigrationTarget[]) => sql`
DO $$
DECLARE
	unsupported_source_combinations text;
BEGIN
	IF to_regclass('public.metadata') IS NULL THEN
		RETURN;
	END IF;

	WITH metadata_targets (lot, source, entity_schema_slug, sandbox_script_slug) AS (
		VALUES ${metadataMigrationTargetValuesSql}
	)
	SELECT string_agg(format('%s|%s', lot, source), ', ' ORDER BY lot, source)
	INTO unsupported_source_combinations
	FROM (
		SELECT DISTINCT metadata.lot AS lot, metadata.source AS source
		FROM metadata
		LEFT JOIN metadata_targets ON metadata_targets.lot = metadata.lot AND metadata_targets.source = metadata.source
		WHERE metadata_targets.lot IS NULL
	) AS unsupported_targets;

	IF unsupported_source_combinations IS NOT NULL THEN
		RAISE EXCEPTION 'Unsupported legacy metadata sources: %', unsupported_source_combinations;
	END IF;

	WITH metadata_targets (lot, source, entity_schema_id, sandbox_script_id) AS (
		VALUES ${buildMetadataMigrationTargetValuesSql(targets)}
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
		CASE
			WHEN jsonb_array_length(metadata.assets -> 'remote_images') > 0 THEN jsonb_build_object(
				'type', 'remote',
				'url', metadata.assets -> 'remote_images' ->> 0
			)
			WHEN jsonb_array_length(metadata.assets -> 's3_images') > 0 THEN jsonb_build_object(
				'type', 's3',
				'key', metadata.assets -> 's3_images' ->> 0
			)
			ELSE NULL
		END,
		metadata.created_on,
		metadata.last_updated_on,
		NULL,
		'{}'::jsonb,
		metadata_targets.entity_schema_id,
		metadata_targets.sandbox_script_id,
		metadata.last_updated_on
	FROM metadata
	INNER JOIN metadata_targets ON metadata_targets.lot = metadata.lot AND metadata_targets.source = metadata.source
	ON CONFLICT ("id") DO NOTHING;
END $$;
`;

export const migrateLegacyTables = async (database: DbClient) => {
	const entitySchemas = await database
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
		})
		.from(entitySchema)
		.where(isNull(entitySchema.userId));

	const sandboxScripts = await database
		.select({
			id: sandboxScript.id,
			slug: sandboxScript.slug,
		})
		.from(sandboxScript)
		.where(and(isNull(sandboxScript.userId), eq(sandboxScript.isBuiltin, true)));

	const entitySchemaIds = buildUniqueSlugMap(entitySchemas, "entity schema");
	const sandboxScriptIds = buildUniqueSlugMap(sandboxScripts, "sandbox script");

	const resolvedTargets = metadataMigrationTargets.map((target) => {
		const entitySchemaId = entitySchemaIds.get(target.entitySchemaSlug);
		if (entitySchemaId === undefined) {
			throw new Error(`Missing entity schema id for slug "${target.entitySchemaSlug}"`);
		}

		const sandboxScriptId: string | null =
			target.sandboxScriptSlug === null
				? null
				: (sandboxScriptIds.get(target.sandboxScriptSlug) ?? null);
		if (target.sandboxScriptSlug !== null && sandboxScriptId === null) {
			throw new Error(`Missing sandbox script id for slug "${target.sandboxScriptSlug}"`);
		}

		return {
			entitySchemaId,
			sandboxScriptId,
			lot: target.lot,
			source: target.source,
		};
	});

	await database.execute(buildMetadataMigrationSql(resolvedTargets));
	await database.execute(migrateUserTableSql);
};
