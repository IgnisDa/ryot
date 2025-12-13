import { quoteSqlString } from "./shared";

type LegacyEpisodicSubEntityMigrationInput = {
	showSeasonEntitySchemaId: string;
	showEpisodeEntitySchemaId: string;
	podcastEpisodeEntitySchemaId: string;
	showToSeasonRelationshipSchemaId: string;
	seasonToEpisodeRelationshipSchemaId: string;
	podcastToEpisodeRelationshipSchemaId: string;
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
	RAISE NOTICE 'legacy episodic sub-entities: migration started (% seconds elapsed)', 0.0;

	CREATE TEMP TABLE _legacy_show_seasons ON COMMIT DROP AS
	SELECT
		m.id AS parent_entity_id,
		m.sandbox_script_id,
		season.value,
		season.value ->> 'id' AS external_id,
		(season.value ->> 'season_number')::int AS season_number,
		md5('legacy-show-season:' || COALESCE(m.sandbox_script_id, '') || ':' || (season.value ->> 'id')) AS entity_id,
		m.created_at,
		m.updated_at
	FROM "metadata" legacy_metadata
	INNER JOIN "entity" m ON m.id = legacy_metadata.id
	INNER JOIN "entity_schema" parent_schema
		ON parent_schema.id = m.entity_schema_id
		AND parent_schema.slug = 'show'
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof(legacy_metadata.show_specifics -> 'seasons') = 'array'
			THEN legacy_metadata.show_specifics -> 'seasons'
			ELSE '[]'::jsonb
		END
	) AS season(value)
	WHERE NULLIF(season.value ->> 'id', '') IS NOT NULL
	  AND (season.value ->> 'season_number') ~ '^[0-9]+$';

	CREATE INDEX ON _legacy_show_seasons (parent_entity_id, entity_id);
	CREATE INDEX ON _legacy_show_seasons (sandbox_script_id, external_id);

	CREATE TEMP TABLE _legacy_show_season_entities ON COMMIT DROP AS
	SELECT DISTINCT ON (sandbox_script_id, external_id) *
	FROM _legacy_show_seasons
	ORDER BY sandbox_script_id, external_id, updated_at DESC, parent_entity_id;

	CREATE UNIQUE INDEX ON _legacy_show_season_entities (entity_id);

	CREATE TEMP TABLE _legacy_show_episodes ON COMMIT DROP AS
	SELECT
		show_season.parent_entity_id,
		show_season.sandbox_script_id,
		show_season.value AS season_value,
		episode.value AS episode_value,
		episode.value ->> 'id' AS external_id,
		show_season.entity_id AS season_entity_id,
		md5('legacy-show-episode:' || COALESCE(show_season.sandbox_script_id, '') || ':' || (episode.value ->> 'id')) AS entity_id,
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
	CREATE INDEX ON _legacy_show_episodes (sandbox_script_id, external_id);

	CREATE TEMP TABLE _legacy_show_episode_entities ON COMMIT DROP AS
	SELECT DISTINCT ON (sandbox_script_id, external_id) *
	FROM _legacy_show_episodes
	ORDER BY sandbox_script_id, external_id, updated_at DESC, parent_entity_id;

	CREATE UNIQUE INDEX ON _legacy_show_episode_entities (entity_id);

	CREATE TEMP TABLE _legacy_podcast_episodes ON COMMIT DROP AS
	SELECT
		m.id AS parent_entity_id,
		m.sandbox_script_id,
		episode.value,
		episode.value ->> 'id' AS external_id,
		md5('legacy-podcast-episode:' || COALESCE(m.sandbox_script_id, '') || ':' || (episode.value ->> 'id')) AS entity_id,
		m.created_at,
		m.updated_at
	FROM "metadata" legacy_metadata
	INNER JOIN "entity" m ON m.id = legacy_metadata.id
	INNER JOIN "entity_schema" parent_schema
		ON parent_schema.id = m.entity_schema_id
		AND parent_schema.slug = 'podcast'
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof(legacy_metadata.podcast_specifics -> 'episodes') = 'array'
			THEN legacy_metadata.podcast_specifics -> 'episodes'
			ELSE '[]'::jsonb
		END
	) AS episode(value)
	WHERE NULLIF(episode.value ->> 'id', '') IS NOT NULL
	  AND (episode.value ->> 'number') ~ '^[0-9]+$';

	CREATE INDEX ON _legacy_podcast_episodes (parent_entity_id, entity_id);
	CREATE INDEX ON _legacy_podcast_episodes (sandbox_script_id, external_id);

	CREATE TEMP TABLE _legacy_podcast_episode_entities ON COMMIT DROP AS
	SELECT DISTINCT ON (sandbox_script_id, external_id) *
	FROM _legacy_podcast_episodes
	ORDER BY sandbox_script_id, external_id, updated_at DESC, parent_entity_id;

	CREATE UNIQUE INDEX ON _legacy_podcast_episode_entities (entity_id);
	ANALYZE _legacy_show_seasons;
	ANALYZE _legacy_show_season_entities;
	ANALYZE _legacy_show_episodes;
	ANALYZE _legacy_show_episode_entities;
	ANALYZE _legacy_podcast_episodes;
	ANALYZE _legacy_podcast_episode_entities;

	IF to_regclass('pg_temp._legacy_show_episode_resolution') IS NOT NULL THEN
		DROP TABLE _legacy_show_episode_resolution;
	END IF;

	CREATE TEMP TABLE _legacy_show_episode_resolution AS
	WITH candidates AS (
		SELECT DISTINCT
			parent_entity_id,
			season_value ->> 'season_number' AS season_number,
			episode_value ->> 'episode_number' AS episode_number,
			entity_id,
			${quoteSqlString(input.showEpisodeEntitySchemaId)} AS entity_schema_id
		FROM _legacy_show_episodes
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

	IF to_regclass('pg_temp._legacy_podcast_episode_resolution') IS NOT NULL THEN
		DROP TABLE _legacy_podcast_episode_resolution;
	END IF;

	CREATE TEMP TABLE _legacy_podcast_episode_resolution AS
	WITH candidates AS (
		SELECT DISTINCT
			parent_entity_id,
			value ->> 'number' AS episode_number,
			entity_id,
			${quoteSqlString(input.podcastEpisodeEntitySchemaId)} AS entity_schema_id
		FROM _legacy_podcast_episodes
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

	INSERT INTO "entity" (
		"id",
		"external_id",
		"name",
		"created_at",
		"populated_at",
		"user_id",
		"properties",
		"entity_schema_id",
		"sandbox_script_id",
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
		NOW(),
		NULL,
		jsonb_strip_nulls(jsonb_build_object(
			'description',  show_seasons.value ->> 'overview',
			'releaseDate',  show_seasons.value ->> 'publish_date',
			'seasonNumber', (show_seasons.value ->> 'season_number')::int
		)),
		${quoteSqlString(input.showSeasonEntitySchemaId)},
		show_seasons.sandbox_script_id,
		show_seasons.updated_at
	FROM _legacy_show_season_entities show_seasons
	WHERE NOT EXISTS (
		SELECT 1
		FROM "entity" existing
		WHERE existing.user_id IS NULL
		  AND existing.external_id = show_seasons.external_id
		  AND existing.entity_schema_id = ${quoteSqlString(input.showSeasonEntitySchemaId)}
		  AND existing.sandbox_script_id IS NOT DISTINCT FROM show_seasons.sandbox_script_id
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
		"entity_schema_id",
		"sandbox_script_id",
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
		NOW(),
		NULL,
		jsonb_strip_nulls(jsonb_build_object(
			'runtime',       CASE WHEN (show_episodes.episode_value ->> 'runtime') ~ '^[0-9]+$'
				THEN (show_episodes.episode_value ->> 'runtime')::int END,
			'description',   show_episodes.episode_value ->> 'overview',
			'publishDate',   show_episodes.episode_value ->> 'publish_date',
			'seasonNumber',  (show_episodes.season_value ->> 'season_number')::int,
			'episodeNumber', (show_episodes.episode_value ->> 'episode_number')::int
		)),
		${quoteSqlString(input.showEpisodeEntitySchemaId)},
		show_episodes.sandbox_script_id,
		show_episodes.updated_at
	FROM _legacy_show_episode_entities show_episodes
	WHERE NOT EXISTS (
		SELECT 1
		FROM "entity" existing
		WHERE existing.user_id IS NULL
		  AND existing.external_id = show_episodes.external_id
		  AND existing.entity_schema_id = ${quoteSqlString(input.showEpisodeEntitySchemaId)}
		  AND existing.sandbox_script_id IS NOT DISTINCT FROM show_episodes.sandbox_script_id
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
		"entity_schema_id",
		"sandbox_script_id",
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
		NOW(),
		NULL,
		jsonb_strip_nulls(jsonb_build_object(
			'runtime',       CASE WHEN (podcast_episodes.value ->> 'runtime') ~ '^[0-9]+$'
				THEN (podcast_episodes.value ->> 'runtime')::int END,
			'description',   podcast_episodes.value ->> 'overview',
			'publishDate',   podcast_episodes.value ->> 'publish_date',
			'episodeNumber', (podcast_episodes.value ->> 'number')::int
		)),
		${quoteSqlString(input.podcastEpisodeEntitySchemaId)},
		podcast_episodes.sandbox_script_id,
		podcast_episodes.updated_at
	FROM _legacy_podcast_episode_entities podcast_episodes
	WHERE NOT EXISTS (
		SELECT 1
		FROM "entity" existing
		WHERE existing.user_id IS NULL
		  AND existing.external_id = podcast_episodes.external_id
		  AND existing.entity_schema_id = ${quoteSqlString(input.podcastEpisodeEntitySchemaId)}
		  AND existing.sandbox_script_id IS NOT DISTINCT FROM podcast_episodes.sandbox_script_id
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
		"relationship_schema_id",
		"properties",
		"user_id",
		"created_at"
	)
	SELECT
		gen_random_uuid()::text,
		show_seasons.parent_entity_id,
		show_seasons.entity_id,
		${quoteSqlString(input.showToSeasonRelationshipSchemaId)},
		'{}'::jsonb,
		NULL,
		NOW()
	FROM (
		SELECT DISTINCT parent_entity_id, entity_id
		FROM _legacy_show_seasons
	) show_seasons
	ON CONFLICT ("source_entity_id", "target_entity_id", "relationship_schema_id") WHERE user_id IS NULL DO NOTHING;
	GET DIAGNOSTICS show_season_relationships_inserted = ROW_COUNT;

	INSERT INTO "relationship" (
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
		show_episodes.season_entity_id,
		show_episodes.entity_id,
		${quoteSqlString(input.seasonToEpisodeRelationshipSchemaId)},
		'{}'::jsonb,
		NULL,
		NOW()
	FROM (
		SELECT DISTINCT season_entity_id, entity_id
		FROM _legacy_show_episodes
	) show_episodes
	ON CONFLICT ("source_entity_id", "target_entity_id", "relationship_schema_id") WHERE user_id IS NULL DO NOTHING;
	GET DIAGNOSTICS show_episode_relationships_inserted = ROW_COUNT;

	INSERT INTO "relationship" (
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
		podcast_episodes.parent_entity_id,
		podcast_episodes.entity_id,
		${quoteSqlString(input.podcastToEpisodeRelationshipSchemaId)},
		'{}'::jsonb,
		NULL,
		NOW()
	FROM (
		SELECT DISTINCT parent_entity_id, entity_id
		FROM _legacy_podcast_episodes
	) podcast_episodes
	ON CONFLICT ("source_entity_id", "target_entity_id", "relationship_schema_id") WHERE user_id IS NULL DO NOTHING;
	GET DIAGNOSTICS podcast_episode_relationships_inserted = ROW_COUNT;

	RAISE NOTICE 'legacy episodic sub-entities: % show seasons, % show episodes, % podcast episodes, % show-season relationships, % show-episode relationships, % podcast-episode relationships migrated (% seconds elapsed)',
		show_seasons_inserted,
		show_episodes_inserted,
		podcast_episodes_inserted,
		show_season_relationships_inserted,
		show_episode_relationships_inserted,
		podcast_episode_relationships_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
