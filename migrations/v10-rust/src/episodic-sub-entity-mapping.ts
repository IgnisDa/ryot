import type { QualifiedSchema } from "./migration-resolution";
import { buildReportSql, quoteNullableSqlString, quoteSqlString } from "./shared";

type LegacyEpisodicSubEntityMigrationInput = {
	showSeasonEntitySchema: QualifiedSchema;
	showEpisodeEntitySchema: QualifiedSchema;
	podcastEpisodeEntitySchema: QualifiedSchema;
	showToSeasonRelationshipSchema: QualifiedSchema;
	seasonToEpisodeRelationshipSchema: QualifiedSchema;
	podcastToEpisodeRelationshipSchema: QualifiedSchema;
};

export const buildLegacyEpisodicSubEntityMigrationSql = (
	input: LegacyEpisodicSubEntityMigrationInput,
) => `
DO $$
DECLARE
	show_seasons_inserted int;
	show_episodes_inserted int;
	podcast_episodes_inserted int;
	show_season_relationships_inserted int;
	show_episode_relationships_inserted int;
	podcast_episode_relationships_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	CREATE TEMP TABLE _legacy_show_seasons ON COMMIT DROP AS
	SELECT
		m.id AS parent_entity_id,
		m.provider_id,
		m.user_id,
		season.value,
		CASE WHEN m.provider_id IS NOT NULL THEN season.value ->> 'id' END AS external_id,
		(season.value ->> 'season_number')::int AS season_number,
		-- Provider children are shared across parents by provider identity. Custom children have no
		-- provider identity, so their V1 ids only mean something within their own parent.
		CASE
			WHEN m.provider_id IS NOT NULL
			THEN md5('legacy-show-season:' || m.provider_id || ':' || (season.value ->> 'id'))
			ELSE md5('legacy-custom-show-season:' || m.id || ':' || (season.value ->> 'id'))
		END AS entity_id,
		m.created_at,
		m.updated_at
	FROM "metadata" legacy_metadata
	INNER JOIN "entity" m ON m.id = legacy_metadata.id
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof(legacy_metadata.show_specifics -> 'seasons') = 'array'
			THEN legacy_metadata.show_specifics -> 'seasons'
			ELSE '[]'::jsonb
		END
	) AS season(value)
	WHERE m.entity_schema_slug = 'show'
	  AND NULLIF(season.value ->> 'id', '') IS NOT NULL
	  AND (season.value ->> 'season_number') ~ '^[0-9]+$';

	CREATE INDEX ON _legacy_show_seasons (parent_entity_id, entity_id);

	CREATE TEMP TABLE _legacy_show_season_entities ON COMMIT DROP AS
	SELECT DISTINCT ON (entity_id) *
	FROM _legacy_show_seasons
	ORDER BY entity_id, updated_at DESC, parent_entity_id;

	CREATE UNIQUE INDEX ON _legacy_show_season_entities (entity_id);

	CREATE TEMP TABLE _legacy_show_episodes ON COMMIT DROP AS
	SELECT
		show_season.parent_entity_id,
		show_season.provider_id,
		show_season.user_id,
		show_season.value AS season_value,
		episode.value AS episode_value,
		CASE WHEN show_season.provider_id IS NOT NULL THEN episode.value ->> 'id' END AS external_id,
		show_season.entity_id AS season_entity_id,
		CASE
			WHEN show_season.provider_id IS NOT NULL
			THEN md5('legacy-show-episode:' || show_season.provider_id || ':' || (episode.value ->> 'id'))
			ELSE md5('legacy-custom-show-episode:' || show_season.entity_id || ':' || (episode.value ->> 'id'))
		END AS entity_id,
		show_season.created_at,
		show_season.updated_at
	FROM _legacy_show_seasons show_season
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof(show_season.value -> 'episodes') = 'array'
			THEN show_season.value -> 'episodes'
			ELSE '[]'::jsonb
		END
	) AS episode(value)
	WHERE NULLIF(episode.value ->> 'id', '') IS NOT NULL
	  AND (episode.value ->> 'episode_number') ~ '^[0-9]+$';

	CREATE INDEX ON _legacy_show_episodes (season_entity_id, entity_id);

	CREATE TEMP TABLE _legacy_show_episode_entities ON COMMIT DROP AS
	SELECT DISTINCT ON (entity_id) *
	FROM _legacy_show_episodes
	ORDER BY entity_id, updated_at DESC, parent_entity_id;

	CREATE UNIQUE INDEX ON _legacy_show_episode_entities (entity_id);

	CREATE TEMP TABLE _legacy_podcast_episodes ON COMMIT DROP AS
	SELECT
		m.id AS parent_entity_id,
		m.provider_id,
		m.user_id,
		episode.value,
		CASE WHEN m.provider_id IS NOT NULL THEN episode.value ->> 'id' END AS external_id,
		CASE
			WHEN m.provider_id IS NOT NULL
			THEN md5('legacy-podcast-episode:' || m.provider_id || ':' || (episode.value ->> 'id'))
			ELSE md5('legacy-custom-podcast-episode:' || m.id || ':' || (episode.value ->> 'id'))
		END AS entity_id,
		m.created_at,
		m.updated_at
	FROM "metadata" legacy_metadata
	INNER JOIN "entity" m ON m.id = legacy_metadata.id
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof(legacy_metadata.podcast_specifics -> 'episodes') = 'array'
			THEN legacy_metadata.podcast_specifics -> 'episodes'
			ELSE '[]'::jsonb
		END
	) AS episode(value)
	WHERE m.entity_schema_slug = 'podcast'
	  AND NULLIF(episode.value ->> 'id', '') IS NOT NULL
	  AND (episode.value ->> 'number') ~ '^[0-9]+$';

	CREATE INDEX ON _legacy_podcast_episodes (parent_entity_id, entity_id);

	CREATE TEMP TABLE _legacy_podcast_episode_entities ON COMMIT DROP AS
	SELECT DISTINCT ON (entity_id) *
	FROM _legacy_podcast_episodes
	ORDER BY entity_id, updated_at DESC, parent_entity_id;

	CREATE UNIQUE INDEX ON _legacy_podcast_episode_entities (entity_id);
	ANALYZE _legacy_show_seasons;
	ANALYZE _legacy_show_season_entities;
	ANALYZE _legacy_show_episodes;
	ANALYZE _legacy_show_episode_entities;
	ANALYZE _legacy_podcast_episodes;
	ANALYZE _legacy_podcast_episode_entities;

	IF to_regclass('pg_temp._legacy_show_episode_coordinates') IS NOT NULL THEN
		DROP TABLE _legacy_show_episode_coordinates;
	END IF;

	IF to_regclass('pg_temp._legacy_show_episode_resolution') IS NOT NULL THEN
		DROP TABLE _legacy_show_episode_resolution;
	END IF;

	-- Keeps the duplicate count that resolution filters out, so a later phase can tell a coordinate
	-- that is absent from the cached seasons apart from one that appears more than once.
	CREATE TEMP TABLE _legacy_show_episode_coordinates AS
	WITH candidates AS (
		SELECT DISTINCT
			parent_entity_id,
			season_value ->> 'season_number' AS season_number,
			episode_value ->> 'episode_number' AS episode_number,
			entity_id,
			${quoteSqlString(input.showEpisodeEntitySchema.slug)} AS entity_schema_slug
		FROM _legacy_show_episodes
	)
	SELECT
		parent_entity_id,
		season_number,
		episode_number,
		count(*)::int AS candidate_count,
		min(entity_id) AS entity_id,
		min(entity_schema_slug) AS entity_schema_slug
	FROM candidates
	GROUP BY parent_entity_id, season_number, episode_number;

	CREATE UNIQUE INDEX ON _legacy_show_episode_coordinates (
		parent_entity_id,
		season_number,
		episode_number
	);

	CREATE TEMP TABLE _legacy_show_episode_resolution AS
	SELECT parent_entity_id, season_number, episode_number, entity_id, entity_schema_slug
	FROM _legacy_show_episode_coordinates
	WHERE candidate_count = 1;

	CREATE UNIQUE INDEX ON _legacy_show_episode_resolution (
		parent_entity_id,
		season_number,
		episode_number
	);

	IF to_regclass('pg_temp._legacy_podcast_episode_coordinates') IS NOT NULL THEN
		DROP TABLE _legacy_podcast_episode_coordinates;
	END IF;

	IF to_regclass('pg_temp._legacy_podcast_episode_resolution') IS NOT NULL THEN
		DROP TABLE _legacy_podcast_episode_resolution;
	END IF;

	CREATE TEMP TABLE _legacy_podcast_episode_coordinates AS
	WITH candidates AS (
		SELECT DISTINCT
			parent_entity_id,
			value ->> 'number' AS episode_number,
			entity_id,
			${quoteSqlString(input.podcastEpisodeEntitySchema.slug)} AS entity_schema_slug
		FROM _legacy_podcast_episodes
	)
	SELECT
		parent_entity_id,
		episode_number,
		count(*)::int AS candidate_count,
		min(entity_id) AS entity_id,
		min(entity_schema_slug) AS entity_schema_slug
	FROM candidates
	GROUP BY parent_entity_id, episode_number;

	CREATE UNIQUE INDEX ON _legacy_podcast_episode_coordinates (
		parent_entity_id,
		episode_number
	);

	CREATE TEMP TABLE _legacy_podcast_episode_resolution AS
	SELECT parent_entity_id, episode_number, entity_id, entity_schema_slug
	FROM _legacy_podcast_episode_coordinates
	WHERE candidate_count = 1;

	CREATE UNIQUE INDEX ON _legacy_podcast_episode_resolution (
		parent_entity_id,
		episode_number
	);

	IF to_regclass('pg_temp._legacy_episodic_inventory') IS NOT NULL THEN
		DROP TABLE _legacy_episodic_inventory;
	END IF;

	-- What the cached provider metadata actually holds for each parent, as prose an operator can
	-- read directly in a report. The legacy tables it derives from are dropped after the migration.
	CREATE TEMP TABLE _legacy_episodic_inventory AS
	SELECT
		parent_entity_id,
		'seasons ' || string_agg(season_number, ', ' ORDER BY season_number::int) AS available_summary
	FROM (
		SELECT DISTINCT parent_entity_id, season_number FROM _legacy_show_episode_coordinates
	) distinct_seasons
	GROUP BY parent_entity_id
	UNION ALL
	SELECT
		parent_entity_id,
		'episodes ' || min(episode_number::int)::text || '-' || max(episode_number::int)::text
	FROM _legacy_podcast_episode_coordinates
	GROUP BY parent_entity_id;

	CREATE UNIQUE INDEX ON _legacy_episodic_inventory (parent_entity_id);

	ANALYZE _legacy_show_episode_coordinates;
	ANALYZE _legacy_podcast_episode_coordinates;
	ANALYZE _legacy_show_episode_resolution;
	ANALYZE _legacy_podcast_episode_resolution;
	ANALYZE _legacy_episodic_inventory;

	INSERT INTO "entity" (
		"id",
		"external_id",
		"name",
		"created_at",
		"populated_at",
		"user_id",
		"properties",
		"entity_schema_slug",
		"entity_schema_plugin_id",
		"provider_id",
		"updated_at"
	)
	SELECT
		show_seasons.entity_id,
		show_seasons.external_id,
		COALESCE(
			NULLIF(show_seasons.value ->> 'name', ''),
			'Season ' || show_seasons.season_number::text
		),
		show_seasons.created_at,
		NULL,
		show_seasons.user_id,
		jsonb_strip_nulls(jsonb_build_object(
			'description',  show_seasons.value ->> 'overview',
			'releaseDate',  show_seasons.value ->> 'publish_date',
			'seasonNumber', (show_seasons.value ->> 'season_number')::int
		)),
		${quoteSqlString(input.showSeasonEntitySchema.slug)},
		${quoteNullableSqlString(input.showSeasonEntitySchema.pluginId)},
		show_seasons.provider_id,
		show_seasons.updated_at
	FROM _legacy_show_season_entities show_seasons
	WHERE NOT EXISTS (
		SELECT 1
		FROM "entity" existing
		WHERE existing.user_id IS NULL
		  AND existing.external_id = show_seasons.external_id
		  AND existing.entity_schema_slug = ${quoteSqlString(input.showSeasonEntitySchema.slug)}
		  AND existing.provider_id IS NOT DISTINCT FROM show_seasons.provider_id
	)
	ON CONFLICT ("id") DO UPDATE
		SET
			"name" = EXCLUDED."name",
			"properties" = EXCLUDED."properties",
			"populated_at" = EXCLUDED."populated_at",
			"updated_at" = EXCLUDED."updated_at";
	GET DIAGNOSTICS show_seasons_inserted = ROW_COUNT;

	INSERT INTO "entity" (
		"id",
		"external_id",
		"name",
		"created_at",
		"populated_at",
		"user_id",
		"properties",
		"entity_schema_slug",
		"entity_schema_plugin_id",
		"provider_id",
		"updated_at"
	)
	SELECT
		show_episodes.entity_id,
		show_episodes.external_id,
		COALESCE(
			NULLIF(show_episodes.episode_value ->> 'name', ''),
			'Episode ' || (show_episodes.episode_value ->> 'episode_number')
		),
		show_episodes.created_at,
		NULL,
		show_episodes.user_id,
		jsonb_strip_nulls(jsonb_build_object(
			'runtime',       CASE WHEN (show_episodes.episode_value ->> 'runtime') ~ '^[0-9]+$'
				THEN (show_episodes.episode_value ->> 'runtime')::int END,
			'description',   show_episodes.episode_value ->> 'overview',
			'publishDate',   show_episodes.episode_value ->> 'publish_date',
			'seasonNumber',  (show_episodes.season_value ->> 'season_number')::int,
			'episodeNumber', (show_episodes.episode_value ->> 'episode_number')::int
		)),
		${quoteSqlString(input.showEpisodeEntitySchema.slug)},
		${quoteNullableSqlString(input.showEpisodeEntitySchema.pluginId)},
		show_episodes.provider_id,
		show_episodes.updated_at
	FROM _legacy_show_episode_entities show_episodes
	WHERE NOT EXISTS (
		SELECT 1
		FROM "entity" existing
		WHERE existing.user_id IS NULL
		  AND existing.external_id = show_episodes.external_id
		  AND existing.entity_schema_slug = ${quoteSqlString(input.showEpisodeEntitySchema.slug)}
		  AND existing.provider_id IS NOT DISTINCT FROM show_episodes.provider_id
	)
	ON CONFLICT ("id") DO UPDATE
		SET
			"name" = EXCLUDED."name",
			"properties" = EXCLUDED."properties",
			"populated_at" = EXCLUDED."populated_at",
			"updated_at" = EXCLUDED."updated_at";
	GET DIAGNOSTICS show_episodes_inserted = ROW_COUNT;

	INSERT INTO "entity" (
		"id",
		"external_id",
		"name",
		"created_at",
		"populated_at",
		"user_id",
		"properties",
		"entity_schema_slug",
		"entity_schema_plugin_id",
		"provider_id",
		"updated_at"
	)
	SELECT
		podcast_episodes.entity_id,
		podcast_episodes.external_id,
		COALESCE(
			NULLIF(podcast_episodes.value ->> 'title', ''),
			'Episode ' || (podcast_episodes.value ->> 'number')
		),
		podcast_episodes.created_at,
		NULL,
		podcast_episodes.user_id,
		jsonb_strip_nulls(jsonb_build_object(
			'runtime',       CASE WHEN (podcast_episodes.value ->> 'runtime') ~ '^[0-9]+$'
				THEN (podcast_episodes.value ->> 'runtime')::int END,
			'description',   podcast_episodes.value ->> 'overview',
			'publishDate',   podcast_episodes.value ->> 'publish_date',
			'episodeNumber', (podcast_episodes.value ->> 'number')::int
		)),
		${quoteSqlString(input.podcastEpisodeEntitySchema.slug)},
		${quoteNullableSqlString(input.podcastEpisodeEntitySchema.pluginId)},
		podcast_episodes.provider_id,
		podcast_episodes.updated_at
	FROM _legacy_podcast_episode_entities podcast_episodes
	WHERE NOT EXISTS (
		SELECT 1
		FROM "entity" existing
		WHERE existing.user_id IS NULL
		  AND existing.external_id = podcast_episodes.external_id
		  AND existing.entity_schema_slug = ${quoteSqlString(input.podcastEpisodeEntitySchema.slug)}
		  AND existing.provider_id IS NOT DISTINCT FROM podcast_episodes.provider_id
	)
	ON CONFLICT ("id") DO UPDATE
		SET
			"name" = EXCLUDED."name",
			"properties" = EXCLUDED."properties",
			"populated_at" = EXCLUDED."populated_at",
			"updated_at" = EXCLUDED."updated_at";
	GET DIAGNOSTICS podcast_episodes_inserted = ROW_COUNT;

	INSERT INTO "relationship" (
		"id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties",
		"user_id",
		"created_at"
	)
	SELECT
		gen_random_uuid()::text,
		show_seasons.parent_entity_id,
		show_seasons.entity_id,
		${quoteSqlString(input.showToSeasonRelationshipSchema.slug)},
		${quoteNullableSqlString(input.showToSeasonRelationshipSchema.pluginId)},
		'{}'::jsonb,
		show_seasons.user_id,
		NOW()
	FROM (
		SELECT DISTINCT parent_entity_id, entity_id, user_id
		FROM _legacy_show_seasons
	) show_seasons
	ON CONFLICT ("user_id", "source_entity_id", "target_entity_id", "relationship_schema_slug", "relationship_schema_plugin_id") DO NOTHING;
	GET DIAGNOSTICS show_season_relationships_inserted = ROW_COUNT;

	INSERT INTO "relationship" (
		"id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties",
		"user_id",
		"created_at"
	)
	SELECT
		gen_random_uuid()::text,
		show_episodes.season_entity_id,
		show_episodes.entity_id,
		${quoteSqlString(input.seasonToEpisodeRelationshipSchema.slug)},
		${quoteNullableSqlString(input.seasonToEpisodeRelationshipSchema.pluginId)},
		'{}'::jsonb,
		show_episodes.user_id,
		NOW()
	FROM (
		SELECT DISTINCT season_entity_id, entity_id, user_id
		FROM _legacy_show_episodes
	) show_episodes
	ON CONFLICT ("user_id", "source_entity_id", "target_entity_id", "relationship_schema_slug", "relationship_schema_plugin_id") DO NOTHING;
	GET DIAGNOSTICS show_episode_relationships_inserted = ROW_COUNT;

	INSERT INTO "relationship" (
		"id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties",
		"user_id",
		"created_at"
	)
	SELECT
		gen_random_uuid()::text,
		podcast_episodes.parent_entity_id,
		podcast_episodes.entity_id,
		${quoteSqlString(input.podcastToEpisodeRelationshipSchema.slug)},
		${quoteNullableSqlString(input.podcastToEpisodeRelationshipSchema.pluginId)},
		'{}'::jsonb,
		podcast_episodes.user_id,
		NOW()
	FROM (
		SELECT DISTINCT parent_entity_id, entity_id, user_id
		FROM _legacy_podcast_episodes
	) podcast_episodes
	ON CONFLICT ("user_id", "source_entity_id", "target_entity_id", "relationship_schema_slug", "relationship_schema_plugin_id") DO NOTHING;
	GET DIAGNOSTICS podcast_episode_relationships_inserted = ROW_COUNT;

	${buildReportSql("legacy episodic sub-entities", [
		{ count: "show_seasons_inserted", message: "show seasons migrated" },
		{ count: "show_episodes_inserted", message: "show episodes migrated" },
		{ count: "podcast_episodes_inserted", message: "podcast episodes migrated" },
		{ count: "show_season_relationships_inserted", message: "show-season relationships migrated" },
		{
			count: "show_episode_relationships_inserted",
			message: "show-episode relationships migrated",
		},
		{
			count: "podcast_episode_relationships_inserted",
			message: "podcast-episode relationships migrated",
		},
	])}
END $$;
`;
