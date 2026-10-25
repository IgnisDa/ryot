import {
	consumptionBasisRules,
	defaultConsumptionBasisRule,
} from "@ryot-app/media-plugin/shared/consumption";

import { buildAbortOnRowsSql, quoteSqlString } from "./shared";

type ConsumptionBasisRule = typeof defaultConsumptionBasisRule;

export const consumptionBasisSql = (
	slug: string,
	value: (rule: ConsumptionBasisRule) => string | number | undefined,
) => {
	const sql = (rule: ConsumptionBasisRule) => {
		const result = value(rule);
		if (result === undefined) {
			return "NULL";
		}
		return typeof result === "number" ? String(result) : quoteSqlString(result);
	};
	const cases = Array.from(
		consumptionBasisRules,
		([ruleSlug, rule]) => `WHEN ${quoteSqlString(ruleSlug)} THEN ${sql(rule)}`,
	);
	return `CASE ${slug} ${cases.join(" ")} ELSE ${sql(defaultConsumptionBasisRule)} END`;
};

const recordedSlug = `CASE WHEN e.entity_schema_slug IN ('show', 'podcast')
	THEN e.entity_schema_slug || '-episode' ELSE e.entity_schema_slug END`;

export const buildSeenConsumptionFactsSql = (mediaPluginId: string) => `
	${buildAbortOnRowsSql({
		countVariable: "invalid_source_rows",
		sampleVariable: "invalid_source_sample",
		message:
			"seen -> event: % source row(s) have missing or conflicting migrated media identity or ownership: %. All seen targets must have been copied before history. Keep the dump and report this migration conflict; silently skipping these records would lose history.",
		source: `SELECT s.id AS label FROM "seen" s
			LEFT JOIN "metadata" metadata ON metadata.id = s.metadata_id
			LEFT JOIN "entity" target ON target.id = s.metadata_id
			WHERE metadata.id IS NULL OR target.id IS NULL
				OR target.entity_schema_plugin_id IS DISTINCT FROM ${quoteSqlString(mediaPluginId)}
				OR (target.user_id IS NOT NULL AND target.user_id <> s.user_id)`,
	})}

	CREATE TEMP TABLE _legacy_seen_consumption ON COMMIT DROP AS
	SELECT source.*, CASE
		WHEN entity_schema_slug = 'anime' AND source_position IS NOT NULL THEN 'episodes'
		WHEN entity_schema_slug = 'manga' AND source_position IS NOT NULL THEN 'chapters'
		WHEN entity_schema_slug = 'manga' AND source_volume IS NOT NULL THEN 'volumes'
	END AS item_unit
	FROM (
	SELECT
		s.id AS seen_id,
		s.user_id,
		s.metadata_id,
		e.entity_schema_slug,
		s.state,
		s.progress,
		s.manual_time_spent,
		s.started_on,
		s.finished_on,
		s.updated_at[array_length(s.updated_at, 1)] AS ordering_time,
		COALESCE(NULLIF(s.providers_consumed_on[array_length(s.updated_at, 1)], ''),
			NULLIF(s.providers_consumed_on[1], '')) AS consumed_on,
		CASE e.entity_schema_slug
			WHEN 'anime' THEN s.anime_extra_information ->> 'episode'
			WHEN 'manga' THEN NULLIF(s.manga_extra_information ->> 'chapter', '')
		END AS source_position,
		CASE WHEN e.entity_schema_slug = 'manga'
			THEN NULLIF(s.manga_extra_information ->> 'volume', '') END AS source_volume,
		COALESCE(show_episode.entity_id, podcast_episode.entity_id) AS episode_entity_id,
		CASE
			WHEN e.entity_schema_slug = 'show'
				AND (s.show_extra_information ->> 'season') ~ '^[0-9]+$'
				AND (s.show_extra_information ->> 'season')::numeric > 0 THEN s.metadata_id
			WHEN e.entity_schema_slug = 'podcast' THEN s.metadata_id
		END AS episode_session_id,
		${consumptionBasisSql(recordedSlug, (rule) => rule.unit)} AS basis_unit,
		${consumptionBasisSql(recordedSlug, (rule) => rule.property)} AS basis_property,
		${consumptionBasisSql(recordedSlug, (rule) => rule.divisor ?? 1)} AS basis_divisor,
		CASE e.entity_schema_slug
			WHEN 'audiobook' THEN m.audio_book_specifics ->> 'runtime'
			WHEN 'movie' THEN m.movie_specifics ->> 'runtime'
			WHEN 'music' THEN m.music_specifics ->> 'duration'
			WHEN 'visual-novel' THEN m.visual_novel_specifics ->> 'length'
			WHEN 'book' THEN m.book_specifics ->> 'pages'
			WHEN 'comic-book' THEN m.comic_book_specifics ->> 'page_count'
			WHEN 'anime' THEN m.anime_specifics ->> 'episodes'
			WHEN 'manga' THEN NULLIF(m.manga_specifics ->> 'chapters', '')
			WHEN 'show' THEN episode.properties ->> 'runtime'
			WHEN 'podcast' THEN episode.properties ->> 'runtime'
		END AS basis_total
	FROM "seen" s
	INNER JOIN "metadata" m ON m.id = s.metadata_id
	INNER JOIN "entity" e ON e.id = s.metadata_id
	LEFT JOIN _legacy_show_episode_resolution show_episode
		ON e.entity_schema_slug = 'show'
		AND show_episode.parent_entity_id = s.metadata_id
		AND show_episode.season_number = s.show_extra_information ->> 'season'
		AND show_episode.episode_number = s.show_extra_information ->> 'episode'
	LEFT JOIN _legacy_podcast_episode_resolution podcast_episode
		ON e.entity_schema_slug = 'podcast'
		AND podcast_episode.parent_entity_id = s.metadata_id
		AND podcast_episode.episode_number = s.podcast_extra_information ->> 'episode'
	LEFT JOIN "entity" episode
		ON episode.id = COALESCE(show_episode.entity_id, podcast_episode.entity_id)
	) source;

	CREATE UNIQUE INDEX ON _legacy_seen_consumption (seen_id);
	ANALYZE _legacy_seen_consumption;

	${buildAbortOnRowsSql({
		countVariable: "invalid_source_rows",
		sampleVariable: "invalid_source_sample",
		message:
			"seen -> event: % source row(s) have invalid state, progress, manual time, source identity, or ordering timestamps: %. These facts cannot be converted without changing recorded evidence. Correct the identified V1 rows and restore a fresh copy before retrying.",
		source: `
			SELECT seen_id AS label FROM _legacy_seen_consumption
			WHERE state IS NULL OR state NOT IN ('completed', 'in_progress', 'dropped', 'on_a_hold')
				OR progress IS NULL OR progress::text IN ('NaN', 'Infinity', '-Infinity')
				OR progress < 0 OR progress > 100
				OR manual_time_spent::text IN ('NaN', 'Infinity', '-Infinity')
				OR manual_time_spent < 0
				OR (manual_time_spent IS NOT NULL AND NOT pg_input_is_valid((manual_time_spent / 60.0)::text, 'double precision'))
				OR length('seen:' || seen_id) > 200
				OR ordering_time IS NULL OR NOT isfinite(ordering_time)
				OR NOT isfinite(started_on) OR NOT isfinite(finished_on)
		`,
	})}

	${buildAbortOnRowsSql({
		countVariable: "invalid_source_rows",
		sampleVariable: "invalid_source_sample",
		message:
			"seen -> event: % source row(s) have invalid metadata quantities or positional values: %. Negative, nonfinite, or malformed quantities cannot become canonical consumption facts. Correct the identified V1 metadata or seen values and restore a fresh copy before retrying.",
		source: `
			SELECT DISTINCT source.seen_id AS label
			FROM _legacy_seen_consumption source
			CROSS JOIN LATERAL (VALUES
				(source.basis_total), (source.source_position), (source.source_volume)
			) quantity(value)
			WHERE quantity.value IS NOT NULL AND NOT CASE
				WHEN pg_input_is_valid(quantity.value, 'double precision')
				THEN quantity.value::double precision >= 0
					AND quantity.value::double precision < 'Infinity'::double precision
				ELSE false END
		`,
	})}

	${buildAbortOnRowsSql({
		countVariable: "invalid_source_rows",
		sampleVariable: "invalid_source_sample",
		message:
			"seen -> event: % source position(s) cannot be represented by the canonical integer fields: %. Anime episode numbers and partial chapter volume context require integers. Keep the dump and report this schema mismatch; do not round or discard source evidence.",
		source: `
			SELECT seen_id AS label FROM _legacy_seen_consumption
			WHERE (entity_schema_slug = 'anime' AND source_position::numeric <> trunc(source_position::numeric))
				OR (item_unit = 'chapters' AND source_volume::numeric <> trunc(source_volume::numeric)
					AND NOT (state = 'completed' OR (state = 'in_progress' AND progress = 100)))
		`,
	})}

	${buildAbortOnRowsSql({
		countVariable: "invalid_source_rows",
		sampleVariable: "invalid_source_sample",
		source: `
			SELECT seen_id AS label FROM _legacy_seen_consumption
			WHERE entity_schema_slug IN ('anime', 'manga') AND item_unit IS NULL
				AND state = 'in_progress' AND progress = 100
		`,
		message:
			"seen -> event: % unpositioned anime/manga row(s) have 100 percent progress without an explicit completed state: %. The source does not identify an independent item or an explicit whole-title completion. Keep the dump and report this ambiguous source state before retrying; the migration will not guess a completion.",
	})}
`;

export const seenConsumptionPropertiesSql = (
	alias: string,
) => `jsonb_strip_nulls(jsonb_build_object(
	'consumptionBasis', jsonb_strip_nulls(jsonb_build_object(
		'unit', ${alias}.basis_unit,
		'property', ${alias}.basis_property,
		'total', ${alias}.basis_total::numeric / ${alias}.basis_divisor
	)),
	'dateUnknown', true,
	'sourceRun', 'seen:' || ${alias}.seen_id,
	'timeSpent', ${alias}.manual_time_spent / 60.0,
	'startedOn', to_char(${alias}.started_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
	'consumedOn', ${alias}.consumed_on,
	'sourceProgress', CASE WHEN ${alias}.item_unit IS NOT NULL THEN jsonb_build_object(
		'unit', ${alias}.item_unit,
		'position', COALESCE(${alias}.source_position, ${alias}.source_volume)::numeric,
		'percent', ${alias}.progress
	) END
))`;
