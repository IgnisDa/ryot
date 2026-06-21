export const buildEntityTranslationMigrationSql = () => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	RAISE NOTICE 'entity_translation -> entity_translation: migration started (% seconds elapsed)', 0.0;

	IF to_regclass('"old_entity_translation"') IS NULL THEN
		RAISE EXCEPTION 'Expected old_entity_translation table to exist (created by renameLegacyTables) but it was not found';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "old_entity_translation"
		WHERE "variant" NOT IN ('title', 'image', 'description')
	) THEN
		RAISE EXCEPTION 'entity_translation: found an unsupported translation variant';
	END IF;

	WITH show_season_keys AS (
		SELECT DISTINCT
			entity_id AS parent_entity_id,
			show_extra_information ->> 'season' AS season_number
		FROM "old_entity_translation"
		WHERE entity_lot = 'metadata'
			AND show_extra_information IS NOT NULL
			AND show_extra_information ->> 'season' IS NOT NULL
	), show_episode_keys AS (
		SELECT DISTINCT
			entity_id AS parent_entity_id,
			show_extra_information ->> 'season' AS season_number,
			show_extra_information ->> 'episode' AS episode_number
		FROM "old_entity_translation"
		WHERE entity_lot = 'metadata'
			AND show_extra_information IS NOT NULL
			AND show_extra_information ->> 'season' IS NOT NULL
			AND show_extra_information ->> 'episode' IS NOT NULL
	), podcast_episode_keys AS (
		SELECT DISTINCT
			entity_id AS parent_entity_id,
			podcast_extra_information ->> 'episode' AS episode_number
		FROM "old_entity_translation"
		WHERE entity_lot = 'metadata'
			AND podcast_extra_information IS NOT NULL
			AND podcast_extra_information ->> 'episode' IS NOT NULL
	), show_seasons AS (
		SELECT
			show_season_keys.parent_entity_id,
			season_entity.id AS target_entity_id,
			show_season_keys.season_number
		FROM show_season_keys
		INNER JOIN "entity" show_entity
			ON show_entity.id = show_season_keys.parent_entity_id
		INNER JOIN "entity_schema" show_schema
			ON show_schema.id = show_entity.entity_schema_id
			AND show_schema.slug = 'show'
		INNER JOIN "relationship" show_season_relationship
			ON show_season_relationship.source_entity_id = show_entity.id
			AND show_season_relationship.user_id IS NULL
		INNER JOIN "relationship_schema" show_season_schema
			ON show_season_schema.id = show_season_relationship.relationship_schema_id
			AND show_season_schema.slug = 'show-to-show-season'
			AND show_season_schema.user_id IS NULL
		INNER JOIN "entity" season_entity
			ON season_entity.id = show_season_relationship.target_entity_id
			AND season_entity.properties ->> 'seasonNumber' = show_season_keys.season_number
		INNER JOIN "entity_schema" season_schema
			ON season_schema.id = season_entity.entity_schema_id
			AND season_schema.slug = 'show-season'
	), show_episodes AS (
		SELECT
			show_episode_keys.parent_entity_id,
			show_episode_keys.season_number,
			episode_entity.id AS target_entity_id,
			show_episode_keys.episode_number
		FROM show_episode_keys
		INNER JOIN show_seasons
			ON show_seasons.parent_entity_id = show_episode_keys.parent_entity_id
			AND show_seasons.season_number = show_episode_keys.season_number
		INNER JOIN "relationship" season_episode_relationship
			ON season_episode_relationship.source_entity_id = show_seasons.target_entity_id
			AND season_episode_relationship.user_id IS NULL
		INNER JOIN "relationship_schema" season_episode_schema
			ON season_episode_schema.id = season_episode_relationship.relationship_schema_id
			AND season_episode_schema.slug = 'show-season-to-show-episode'
			AND season_episode_schema.user_id IS NULL
		INNER JOIN "entity" episode_entity
			ON episode_entity.id = season_episode_relationship.target_entity_id
			AND episode_entity.properties ->> 'episodeNumber' = show_episode_keys.episode_number
		INNER JOIN "entity_schema" episode_schema
			ON episode_schema.id = episode_entity.entity_schema_id
			AND episode_schema.slug = 'show-episode'
	), podcast_episodes AS (
		SELECT
			podcast_episode_keys.parent_entity_id,
			episode_entity.id AS target_entity_id,
			podcast_episode_keys.episode_number
		FROM podcast_episode_keys
		INNER JOIN "entity" podcast_entity
			ON podcast_entity.id = podcast_episode_keys.parent_entity_id
		INNER JOIN "entity_schema" podcast_schema
			ON podcast_schema.id = podcast_entity.entity_schema_id
			AND podcast_schema.slug = 'podcast'
		INNER JOIN "relationship" podcast_episode_relationship
			ON podcast_episode_relationship.source_entity_id = podcast_entity.id
			AND podcast_episode_relationship.user_id IS NULL
		INNER JOIN "relationship_schema" podcast_episode_schema
			ON podcast_episode_schema.id = podcast_episode_relationship.relationship_schema_id
			AND podcast_episode_schema.slug = 'podcast-to-podcast-episode'
			AND podcast_episode_schema.user_id IS NULL
		INNER JOIN "entity" episode_entity
			ON episode_entity.id = podcast_episode_relationship.target_entity_id
			AND episode_entity.properties ->> 'episodeNumber' = podcast_episode_keys.episode_number
		INNER JOIN "entity_schema" episode_schema
			ON episode_schema.id = episode_entity.entity_schema_id
			AND episode_schema.slug = 'podcast-episode'
	), resolved AS (
		SELECT
			legacy_translation.id,
			legacy_translation.language,
			legacy_translation.variant,
			legacy_translation.value,
			legacy_translation.created_on,
			CASE
				WHEN legacy_translation.show_extra_information IS NOT NULL THEN
					COALESCE(show_episode.target_entity_id, show_season.target_entity_id)
				WHEN legacy_translation.podcast_extra_information IS NOT NULL THEN
					podcast_episode.target_entity_id
				ELSE base_entity.id
			END AS target_entity_id
		FROM "old_entity_translation" legacy_translation
		LEFT JOIN "entity" base_entity
			ON base_entity.id = legacy_translation.entity_id
		LEFT JOIN show_episodes show_episode
			ON legacy_translation.entity_lot = 'metadata'
			AND show_episode.parent_entity_id = legacy_translation.entity_id
			AND show_episode.season_number = legacy_translation.show_extra_information ->> 'season'
			AND show_episode.episode_number = legacy_translation.show_extra_information ->> 'episode'
		LEFT JOIN show_seasons show_season
			ON legacy_translation.entity_lot = 'metadata'
			AND show_season.parent_entity_id = legacy_translation.entity_id
			AND show_season.season_number = legacy_translation.show_extra_information ->> 'season'
			AND legacy_translation.show_extra_information ->> 'episode' IS NULL
		LEFT JOIN podcast_episodes podcast_episode
			ON legacy_translation.entity_lot = 'metadata'
			AND podcast_episode.parent_entity_id = legacy_translation.entity_id
			AND podcast_episode.episode_number = legacy_translation.podcast_extra_information ->> 'episode'
	), deduplicated AS (
		SELECT DISTINCT ON (target_entity_id, language, variant)
			target_entity_id,
			language,
			variant,
			value,
			created_on
		FROM resolved
		WHERE target_entity_id IS NOT NULL
		ORDER BY target_entity_id, language, variant, created_on DESC, id DESC
	), aggregated AS (
		SELECT
			target_entity_id,
			language,
			MIN(created_on) AS created_at,
			MAX(created_on) AS updated_at,
			MAX(created_on) AS populated_at,
			MAX(value) FILTER (WHERE variant = 'title') AS name,
			NULLIF(
				jsonb_strip_nulls(jsonb_build_object(
					'description', MAX(value) FILTER (
						WHERE variant = 'description' AND NULLIF(value, '') IS NOT NULL
					),
					'images', CASE
						WHEN MAX(value) FILTER (
							WHERE variant = 'image' AND NULLIF(value, '') IS NOT NULL
						) IS NULL THEN NULL
						ELSE jsonb_build_array(jsonb_build_object(
							'type', 'remote',
							'url', MAX(value) FILTER (
								WHERE variant = 'image' AND NULLIF(value, '') IS NOT NULL
							)
						))
					END
				)), '{}'::jsonb
			) AS properties
		FROM deduplicated
		GROUP BY target_entity_id, language
	)
	INSERT INTO "entity_translation" (
		"id",
		"name",
		"language",
		"properties",
		"populated_at",
		"created_at",
		"entity_id",
		"updated_at"
	)
	SELECT
		md5('legacy-entity-translation:' || target_entity_id || ':' || language),
		name,
		language,
		properties,
		populated_at,
		created_at,
		target_entity_id,
		updated_at
	FROM aggregated
	ON CONFLICT DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	RAISE NOTICE 'entity_translation -> entity_translation: % row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
