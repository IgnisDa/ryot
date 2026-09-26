// Rebuilds the episode resolution temp tables from the migrated V2 entity graph when the episodic
// sub-entity phase has not left them behind, so each consuming phase stays runnable on its own.
//
// `_legacy_*_coordinates` keeps the duplicate count that `_legacy_*_resolution` filters out, so an
// absent position can be told apart from one claimed by several episodes.
export const buildEpisodeResolutionFallbackSql = () => `
	IF to_regclass('pg_temp._legacy_show_episode_coordinates') IS NULL
		OR to_regclass('pg_temp._legacy_podcast_episode_coordinates') IS NULL
		OR to_regclass('pg_temp._legacy_show_episode_resolution') IS NULL
		OR to_regclass('pg_temp._legacy_podcast_episode_resolution') IS NULL
		OR to_regclass('pg_temp._legacy_episodic_inventory') IS NULL THEN
		DROP TABLE IF EXISTS _legacy_show_episode_coordinates;
		DROP TABLE IF EXISTS _legacy_podcast_episode_coordinates;
		DROP TABLE IF EXISTS _legacy_show_episode_resolution;
		DROP TABLE IF EXISTS _legacy_podcast_episode_resolution;
		DROP TABLE IF EXISTS _legacy_episodic_inventory;

		CREATE TEMP TABLE _legacy_show_episode_coordinates ON COMMIT DROP AS
		WITH candidates AS (
			SELECT DISTINCT
				show_entity.id AS parent_entity_id,
				season.properties ->> 'seasonNumber' AS season_number,
				episode.properties ->> 'episodeNumber' AS episode_number,
				episode.id AS entity_id,
				episode.entity_schema_slug
			FROM "entity" show_entity
			INNER JOIN "relationship" show_season_rel
				ON  show_season_rel.source_entity_id = show_entity.id
				AND show_season_rel.relationship_schema_slug = 'show-to-show-season'
			INNER JOIN "entity" season
				ON  season.id = show_season_rel.target_entity_id
				AND season.entity_schema_slug = 'show-season'
			INNER JOIN "relationship" season_episode_rel
				ON  season_episode_rel.source_entity_id = season.id
				AND season_episode_rel.relationship_schema_slug = 'show-season-to-show-episode'
			INNER JOIN "entity" episode
				ON  episode.id = season_episode_rel.target_entity_id
				AND episode.entity_schema_slug = 'show-episode'
			WHERE show_entity.entity_schema_slug = 'show'
			  AND (show_season_rel.user_id = show_entity.user_id OR show_season_rel.user_id IS NULL)
			  AND (season_episode_rel.user_id = show_entity.user_id OR season_episode_rel.user_id IS NULL)
			  AND (season.user_id = show_entity.user_id OR season.user_id IS NULL)
			  AND (episode.user_id = show_entity.user_id OR episode.user_id IS NULL)
			  AND (season.properties ->> 'seasonNumber') ~ '^[0-9]+$'
			  AND (episode.properties ->> 'episodeNumber') ~ '^[0-9]+$'
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

		CREATE TEMP TABLE _legacy_show_episode_resolution ON COMMIT DROP AS
		SELECT parent_entity_id, season_number, episode_number, entity_id, entity_schema_slug
		FROM _legacy_show_episode_coordinates
		WHERE candidate_count = 1;

		CREATE UNIQUE INDEX ON _legacy_show_episode_resolution (
			parent_entity_id,
			season_number,
			episode_number
		);

		CREATE TEMP TABLE _legacy_podcast_episode_coordinates ON COMMIT DROP AS
		WITH candidates AS (
			SELECT DISTINCT
				podcast.id AS parent_entity_id,
				episode.properties ->> 'episodeNumber' AS episode_number,
				episode.id AS entity_id,
				episode.entity_schema_slug
			FROM "entity" podcast
			INNER JOIN "relationship" podcast_episode_rel
				ON  podcast_episode_rel.source_entity_id = podcast.id
				AND podcast_episode_rel.relationship_schema_slug = 'podcast-to-podcast-episode'
			INNER JOIN "entity" episode
				ON  episode.id = podcast_episode_rel.target_entity_id
				AND episode.entity_schema_slug = 'podcast-episode'
			WHERE podcast.entity_schema_slug = 'podcast'
			  AND (podcast_episode_rel.user_id = podcast.user_id OR podcast_episode_rel.user_id IS NULL)
			  AND (episode.user_id = podcast.user_id OR episode.user_id IS NULL)
			  AND (episode.properties ->> 'episodeNumber') ~ '^[0-9]+$'
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

		CREATE TEMP TABLE _legacy_podcast_episode_resolution ON COMMIT DROP AS
		SELECT parent_entity_id, episode_number, entity_id, entity_schema_slug
		FROM _legacy_podcast_episode_coordinates
		WHERE candidate_count = 1;

		CREATE UNIQUE INDEX ON _legacy_podcast_episode_resolution (
			parent_entity_id,
			episode_number
		);

		CREATE TEMP TABLE _legacy_episodic_inventory ON COMMIT DROP AS
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
	END IF;
`;

// `jsonb_build_object`, not the `jsonb_strip_nulls` the neighbouring mappings use: the report schema
// models a missing season as an explicit null, and stripping it would drop the key and fail decoding.
const episodeIdentityJson = (alias: string) => `
	'kind', ${alias}.kind,
	'userId', ${alias}.user_id,
	'parentName', ${alias}.parent_name,
	'parentEntityId', ${alias}.parent_entity_id,
	'legacyRecordId', ${alias}.legacy_record_id,
	'requestedSeason', ${alias}.requested_season,
	'requestedEpisode', ${alias}.requested_episode`;

export const buildEpisodeAbsentDetailSql = (code: string, alias: string) =>
	`jsonb_build_object(
		'code', '${code}',${episodeIdentityJson(alias)},
		'seasonExists', ${alias}.season_exists,
		'availableSummary', ${alias}.available_summary
	)`;

export const buildEpisodeAmbiguousDetailSql = (code: string, alias: string) =>
	`jsonb_build_object(
		'code', '${code}',${episodeIdentityJson(alias)},
		'candidateCount', ${alias}.candidate_count
	)`;

export const buildEpisodeMalformedDetailSql = (code: string, alias: string) =>
	`jsonb_build_object('code', '${code}',${episodeIdentityJson(alias)})`;
