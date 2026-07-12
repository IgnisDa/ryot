import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { dbEffect, DbService } from "#lib/infrastructure/db/service";

import { metadataMigrationTargets } from "./metadata-mapping-targets";
import { type ResolvedLotEntityMigrationTarget, buildLotEntityTargetValuesSql } from "./shared";

const metadataMigrationTargetValuesSql = sql.join(
	metadataMigrationTargets.map(
		(target) =>
			sql`(${target.lot}, ${target.source}, ${target.entitySchemaSlug}, ${target.providerSlug})`,
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

// video_game `time_to_beat` is in seconds (IGDB) and converted to minutes; visual_novel `length`
// is already minutes (VNDB). Other branches are straight snake_case → camelCase renames.
const buildMetadataLotSpecificPropertiesSql = () => `
COALESCE(jsonb_strip_nulls(
	CASE
		WHEN metadata.lot = 'show' THEN jsonb_build_object(
			'totalSeasons', COALESCE((
				SELECT count(*)::int
				FROM jsonb_array_elements(
					CASE
						WHEN jsonb_typeof(metadata.show_specifics -> 'seasons') = 'array'
						THEN metadata.show_specifics -> 'seasons'
						ELSE '[]'::jsonb
					END
				) AS season(value)
				WHERE (season.value ->> 'season_number') ~ '^[0-9]+$'
			), 0),
			'totalEpisodes', COALESCE((
				SELECT count(*)::int
				FROM jsonb_array_elements(
					CASE
						WHEN jsonb_typeof(metadata.show_specifics -> 'seasons') = 'array'
						THEN metadata.show_specifics -> 'seasons'
						ELSE '[]'::jsonb
					END
				) AS season(value)
				CROSS JOIN LATERAL jsonb_array_elements(
					CASE
						WHEN jsonb_typeof(season.value -> 'episodes') = 'array'
						THEN season.value -> 'episodes'
						ELSE '[]'::jsonb
					END
				) AS episode(value)
				WHERE (episode.value ->> 'episode_number') ~ '^[0-9]+$'
			), 0)
		)
		WHEN metadata.lot = 'anime' THEN jsonb_build_object(
			'episodes', (metadata.anime_specifics ->> 'episodes')::int,
			'airingSchedule', (
				SELECT jsonb_agg(
					jsonb_build_object(
						'episode', (schedule.value ->> 'episode')::int,
						'airingAt', to_char(
							(schedule.value ->> 'airing_at')::timestamp,
							'YYYY-MM-DD"T"HH24:MI:SS"Z"'
						)
					)
					ORDER BY (schedule.value ->> 'episode')::int
				)
				FROM jsonb_array_elements(
					CASE
						WHEN jsonb_typeof(metadata.anime_specifics -> 'airing_schedule') = 'array'
						THEN metadata.anime_specifics -> 'airing_schedule'
						ELSE '[]'::jsonb
					END
				) AS schedule(value)
			)
		)
		WHEN metadata.lot = 'manga' THEN jsonb_build_object(
			'volumes',  (metadata.manga_specifics ->> 'volumes')::int,
			'chapters', NULLIF(metadata.manga_specifics ->> 'chapters', '')::float8
		)
		WHEN metadata.lot = 'podcast' THEN jsonb_build_object(
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

const buildMetadataPropertiesSql = () => `
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
		WITH metadata_targets (lot, source, entity_schema_slug, provider_id) AS (
			VALUES ${buildLotEntityTargetValuesSql(targets)}
		), batch AS (
			SELECT metadata.id::text AS id
			FROM metadata
			INNER JOIN metadata_targets ON metadata_targets.lot = metadata.lot AND metadata_targets.source = metadata.source
			WHERE metadata.id::text > cursor_id
				AND (
					metadata_targets.provider_id IS NULL
					OR EXISTS (SELECT 1 FROM _referenced_global_entity_ids r WHERE r.id = metadata.id::text)
				)
			ORDER BY metadata.id::text
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		WITH metadata_targets (lot, source, entity_schema_slug, provider_id) AS (
			VALUES ${buildLotEntityTargetValuesSql(targets)}
		)
		INSERT INTO entity (
			"id",
			"external_id",
			"name",
			"created_at",
			"populated_at",
			"user_id",
			"properties",
			"entity_schema_slug",
			"provider_id",
			"updated_at"
		)
		SELECT
			metadata.id,
			metadata.identifier,
			metadata.title,
			metadata.created_on,
			NULL,
			metadata.created_by_user_id,
			CASE
				WHEN metadata_targets.provider_id IS NULL THEN ${buildMetadataPropertiesSql()}
				ELSE '{}'::jsonb
			END,
			metadata_targets.entity_schema_slug,
			metadata_targets.provider_id,
			metadata.last_updated_on
		FROM metadata
		INNER JOIN metadata_targets ON metadata_targets.lot = metadata.lot AND metadata_targets.source = metadata.source
		WHERE metadata.id::text > cursor_id AND metadata.id::text <= next_cursor_id
			AND (
				metadata_targets.provider_id IS NULL
				OR EXISTS (SELECT 1 FROM _referenced_global_entity_ids r WHERE r.id = metadata.id::text)
			)
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

// Provider media suggestions (rebuilt by V2 on population) are not migrated; this guard fails
// loudly if a user-authored suggestion is found. See "Slim Migration Strategy" in AGENTS.md.
export const buildMetadataToMetadataRelationshipMigrationSql = () => `
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "metadata_to_metadata" m2m
		INNER JOIN "metadata" src ON src.id = m2m.from_metadata_id
		INNER JOIN "metadata" tgt ON tgt.id = m2m.to_metadata_id
		WHERE src.created_by_user_id IS NOT NULL OR tgt.created_by_user_id IS NOT NULL
		LIMIT 1
	) THEN
		RAISE EXCEPTION 'metadata_to_metadata -> relationship: found user-authored suggestion links; slim migration would drop them';
	END IF;

	RAISE NOTICE 'metadata_to_metadata -> relationship: skipped (provider-reconstructed on population)';
END $$;
`;

export const getUnsupportedMetadataSources = Effect.gen(function* () {
	const { db } = yield* DbService;
	const result = yield* dbEffect(() =>
		db.execute<{ lot: string; source: string }>(sql`
			WITH metadata_targets (lot, source, entity_schema_slug, provider_slug) AS (
				VALUES ${metadataMigrationTargetValuesSql}
			)
			SELECT DISTINCT
				metadata.lot AS lot,
				metadata.source AS source
			FROM metadata
			LEFT JOIN metadata_targets ON metadata_targets.lot = metadata.lot AND metadata_targets.source = metadata.source
			WHERE metadata_targets.lot IS NULL
			ORDER BY metadata.lot, metadata.source
		`),
	);

	return result.rows;
});
