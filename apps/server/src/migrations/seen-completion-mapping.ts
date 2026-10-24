import { buildAbortOnRowsSql, buildReportSql, quoteSqlString } from "./shared";

export const buildSeenEpisodicCompletionMigrationSql = (mediaPluginId: string) => `
DO $$
DECLARE
	entity_rec record;
	event_rec record;
	covered_keys text[];
	covered_consumed_on jsonb;
	covered_sources jsonb;
	occurrence_id text;
	agreed_consumed_on text;
	show_podcast_complete_inserted int := 0;
	invalid_rows int := 0;
	invalid_sample text;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF EXISTS (SELECT 1 FROM "migration_report" WHERE phase = 'seen parent completion evidence') THEN
		RETURN;
	END IF;
	CREATE TEMP TABLE _seen_completion_outputs ON COMMIT DROP AS
	SELECT id, user_id, entity_id, event_schema_slug, event_schema_plugin_id, session_entity_id,
		properties, created_at, occurred_at, order_created_at, order_key
	FROM "event" WITH NO DATA;
	CREATE UNIQUE INDEX ON _seen_completion_outputs (id);

	CREATE TEMP TABLE _seen_required_coverage ON COMMIT DROP AS
	WITH show_keys AS (
		SELECT DISTINCT
			show_entity.id AS entity_id,
			'show' AS entity_schema_slug,
			episode.id AS coverage_key
		FROM "entity" show_entity
		INNER JOIN "relationship" show_season_rel
			ON  show_season_rel.source_entity_id = show_entity.id
			AND show_season_rel.relationship_schema_slug = 'show-to-show-season'
			AND show_season_rel.relationship_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		INNER JOIN "entity" season
			ON  season.id = show_season_rel.target_entity_id
			AND season.entity_schema_slug = 'show-season'
			AND season.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		INNER JOIN "relationship" season_episode_rel
			ON  season_episode_rel.source_entity_id = season.id
			AND season_episode_rel.relationship_schema_slug = 'show-season-to-show-episode'
			AND season_episode_rel.relationship_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		INNER JOIN "entity" episode
			ON  episode.id = season_episode_rel.target_entity_id
			AND episode.entity_schema_slug = 'show-episode'
			AND episode.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		WHERE show_entity.entity_schema_slug = 'show'
		  AND show_entity.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		  AND (show_season_rel.user_id IS NULL OR show_season_rel.user_id = show_entity.user_id)
		  AND (season_episode_rel.user_id IS NULL OR season_episode_rel.user_id = show_entity.user_id)
		  AND (season.user_id IS NULL OR season.user_id = show_entity.user_id)
		  AND (episode.user_id IS NULL OR episode.user_id = show_entity.user_id)
		  AND (season.properties ->> 'seasonNumber') ~ '^[0-9]+$'
		  AND (season.properties ->> 'seasonNumber')::int > 0
	), podcast_keys AS (
		SELECT DISTINCT
			podcast.id AS entity_id,
			'podcast' AS entity_schema_slug,
			episode.id AS coverage_key
		FROM "entity" podcast
		INNER JOIN "relationship" podcast_episode_rel
			ON  podcast_episode_rel.source_entity_id = podcast.id
			AND podcast_episode_rel.relationship_schema_slug = 'podcast-to-podcast-episode'
			AND podcast_episode_rel.relationship_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		INNER JOIN "entity" episode
			ON  episode.id = podcast_episode_rel.target_entity_id
			AND episode.entity_schema_slug = 'podcast-episode'
			AND episode.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		WHERE podcast.entity_schema_slug = 'podcast'
		  AND podcast.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		  AND (podcast_episode_rel.user_id IS NULL OR podcast_episode_rel.user_id = podcast.user_id)
		  AND (episode.user_id IS NULL OR episode.user_id = podcast.user_id)
	)
	SELECT * FROM show_keys
	UNION ALL SELECT * FROM podcast_keys;

	CREATE INDEX ON _seen_required_coverage (entity_id, coverage_key);

	-- A show is valid only when it has a nonempty regular-season graph. Empty regular seasons remain
	-- visible through the left joins and prevent 0 == 0 completion.
	CREATE TEMP TABLE _seen_required_counts ON COMMIT DROP AS
	WITH show_seasons AS (
		SELECT
			show_entity.id AS entity_id,
			season.id AS season_id,
			count(DISTINCT episode.id)::int AS episode_count
		FROM "entity" show_entity
		INNER JOIN "relationship" show_season_rel
			ON  show_season_rel.source_entity_id = show_entity.id
			AND show_season_rel.relationship_schema_slug = 'show-to-show-season'
			AND show_season_rel.relationship_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		INNER JOIN "entity" season
			ON  season.id = show_season_rel.target_entity_id
			AND season.entity_schema_slug = 'show-season'
			AND season.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		LEFT JOIN "relationship" season_episode_rel
			ON  season_episode_rel.source_entity_id = season.id
			AND season_episode_rel.relationship_schema_slug = 'show-season-to-show-episode'
			AND season_episode_rel.relationship_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		LEFT JOIN "entity" episode
			ON  episode.id = season_episode_rel.target_entity_id
			AND episode.entity_schema_slug = 'show-episode'
			AND episode.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		WHERE show_entity.entity_schema_slug = 'show'
		  AND show_entity.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		  AND (show_season_rel.user_id IS NULL OR show_season_rel.user_id = show_entity.user_id)
		  AND (season_episode_rel.user_id IS NULL OR season_episode_rel.user_id = show_entity.user_id)
		  AND (season.user_id IS NULL OR season.user_id = show_entity.user_id)
		  AND (episode.user_id IS NULL OR episode.user_id = show_entity.user_id)
		  AND (season.properties ->> 'seasonNumber') ~ '^[0-9]+$'
		  AND (season.properties ->> 'seasonNumber')::int > 0
		GROUP BY show_entity.id, season.id
	), valid_shows AS (
		SELECT entity_id, sum(episode_count)::int AS required_count
		FROM show_seasons
		GROUP BY entity_id
		HAVING count(*) > 0 AND bool_and(episode_count > 0) AND sum(episode_count) > 0
	), podcast_counts AS (
		SELECT entity_id, entity_schema_slug, count(*)::int AS required_count
		FROM _seen_required_coverage
		WHERE entity_schema_slug = 'podcast'
		GROUP BY entity_id, entity_schema_slug
		HAVING count(*) > 0
	)
	SELECT entity_id, 'show' AS entity_schema_slug, required_count FROM valid_shows
	UNION ALL
	SELECT entity_id, entity_schema_slug, required_count FROM podcast_counts;

	CREATE UNIQUE INDEX ON _seen_required_counts (entity_id);

	CREATE TEMP TABLE _seen_child_lifecycle ON COMMIT DROP AS
	SELECT
		ev.id AS event_id,
		ev.user_id,
		ev.session_entity_id AS entity_id,
		ev.entity_id AS coverage_key,
		ev.event_schema_slug,
		COALESCE(ev.order_created_at, ev.created_at) AS created_at,
		COALESCE(ev.order_key, ev.id) AS order_key,
		ev.occurred_at,
		NULLIF(ev.properties ->> 'consumedOn', '') AS consumed_on
	FROM "event" ev
	INNER JOIN _seen_required_coverage required
		ON  required.entity_id = ev.session_entity_id
		AND required.coverage_key = ev.entity_id
		AND required.entity_schema_slug IN ('show', 'podcast')
	WHERE ev.event_schema_slug IN ('progress', 'complete')
	  AND ev.event_schema_plugin_id = ${quoteSqlString(mediaPluginId)};

	CREATE INDEX ON _seen_child_lifecycle (
		user_id,
		entity_id,
		occurred_at,
		created_at,
		event_id
	);
	ANALYZE _seen_required_coverage;
	ANALYZE _seen_required_counts;
	ANALYZE _seen_child_lifecycle;

	${buildAbortOnRowsSql({
		countVariable: "invalid_rows",
		sampleVariable: "invalid_sample",
		message:
			"seen parent completion evidence: % history owner(s) have no unique Media Library: %. Frozen completion evidence must be user-owned on that library. Keep the dump and report this migration identity conflict.",
		source: `SELECT child.user_id AS label
			FROM (SELECT DISTINCT user_id FROM _seen_child_lifecycle) child
			LEFT JOIN "entity" library ON library.user_id = child.user_id
				AND library.entity_schema_slug = 'media-library'
				AND library.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
			GROUP BY child.user_id HAVING count(library.id) <> 1`,
	})}

	FOR entity_rec IN
		SELECT DISTINCT
			child.user_id,
			child.entity_id,
			library.id AS library_id,
			required.required_count
		FROM _seen_child_lifecycle child
		INNER JOIN _seen_required_counts required
			ON  required.entity_id = child.entity_id
			AND required.entity_schema_slug IN ('show', 'podcast')
		INNER JOIN "metadata" legacy_metadata ON legacy_metadata.id = child.entity_id
		INNER JOIN "entity" library ON library.user_id = child.user_id
			AND library.entity_schema_slug = 'media-library'
			AND library.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		WHERE lower(trim(legacy_metadata.production_status)) IN ('ended', 'canceled', 'cancelled')
		ORDER BY child.user_id, child.entity_id
	LOOP
		covered_keys := ARRAY[]::text[];
		covered_consumed_on := '{}'::jsonb;
		covered_sources := '{}'::jsonb;

		FOR event_rec IN
			SELECT event_id, coverage_key, event_schema_slug, created_at, occurred_at, order_key, consumed_on
			FROM _seen_child_lifecycle
			WHERE user_id = entity_rec.user_id
			  AND entity_id = entity_rec.entity_id
			ORDER BY occurred_at, created_at, order_key
		LOOP
			IF event_rec.event_schema_slug = 'progress' THEN
				covered_keys := array_remove(covered_keys, event_rec.coverage_key);
				covered_consumed_on := covered_consumed_on - event_rec.coverage_key;
				covered_sources := covered_sources - event_rec.coverage_key;
			ELSE
				IF NOT (event_rec.coverage_key = ANY(covered_keys)) THEN
					covered_keys := covered_keys || event_rec.coverage_key;
				END IF;
				covered_consumed_on := jsonb_set(
					covered_consumed_on,
					ARRAY[event_rec.coverage_key],
					COALESCE(to_jsonb(event_rec.consumed_on), 'null'::jsonb),
					true
				);
				covered_sources := jsonb_set(covered_sources, ARRAY[event_rec.coverage_key], to_jsonb(event_rec.event_id), true);
			END IF;

			IF COALESCE(array_length(covered_keys, 1), 0) = entity_rec.required_count THEN
				SELECT CASE
					WHEN count(*) FILTER (WHERE value IS NOT NULL AND value <> '') = entity_rec.required_count
						AND count(DISTINCT value) = 1 THEN min(value)
				END
			INTO agreed_consumed_on
			FROM jsonb_each_text(covered_consumed_on);

				occurrence_id := md5(event_rec.event_id || ':parent-occurrence');
				INSERT INTO _seen_completion_outputs (
					"id",
					"user_id",
					"entity_id",
					"event_schema_slug",
					"event_schema_plugin_id",
					"session_entity_id",
					"properties",
					"created_at",
					"occurred_at", "order_created_at", "order_key"
				)
				VALUES (
					event_rec.event_id || ':parent-complete',
					entity_rec.user_id,
					entity_rec.entity_id,
					'complete',
					${quoteSqlString(mediaPluginId)},
					entity_rec.entity_id,
					jsonb_strip_nulls(jsonb_build_object(
						'consumedOn', agreed_consumed_on,
						'consumptionBasis', jsonb_build_object('unit', 'episodes'),
						'dateUnknown', true,
						'completionKey', occurrence_id,
						'completionSilent', true
					)),
					event_rec.created_at,
					event_rec.occurred_at,
					event_rec.created_at,
					event_rec.order_key || '~parent'
				);
				show_podcast_complete_inserted := show_podcast_complete_inserted + 1;

				INSERT INTO _seen_completion_outputs (
					id, user_id, entity_id, event_schema_slug, event_schema_plugin_id,
					properties, created_at, occurred_at
				) VALUES (
					occurrence_id, entity_rec.user_id, entity_rec.library_id,
					'completion-occurrence', ${quoteSqlString(mediaPluginId)},
					jsonb_strip_nulls(jsonb_build_object(
						'total', 0, 'runKey', 'legacy-seen', 'frozen', true, 'silent', true,
						'entityId', entity_rec.entity_id, 'subjectEntityId', entity_rec.entity_id,
						'sessionEntityId', entity_rec.entity_id, 'sourceEventId', event_rec.event_id,
						'rule', 'coverage', 'status', 'active',
						'expectedOccurredAt', to_char(event_rec.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
						'expectedOrderCreatedAt', to_char(event_rec.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
						'expectedOrderKey', event_rec.order_key || '~parent',
						'expectedDateUnknown', true, 'expectedConsumedOn', agreed_consumed_on,
						'expectedConsumptionBasis', jsonb_build_object('unit', 'episodes')
					)), event_rec.created_at, event_rec.occurred_at
				);
				INSERT INTO _seen_completion_outputs (
					id, user_id, entity_id, event_schema_slug, event_schema_plugin_id,
					properties, created_at, occurred_at
				)
				SELECT md5(occurrence_id || ':episode:' || support.key), entity_rec.user_id,
					entity_rec.library_id, 'completion-episode', ${quoteSqlString(mediaPluginId)},
					jsonb_build_object('occurrenceId', occurrence_id, 'episodeId', support.key,
						'subjectEntityId', entity_rec.entity_id, 'sourceEventId', support.value),
					event_rec.created_at, event_rec.occurred_at
				FROM jsonb_each_text(covered_sources) support;
				covered_keys := ARRAY[]::text[];
				covered_consumed_on := '{}'::jsonb;
				covered_sources := '{}'::jsonb;
			END IF;
		END LOOP;
	END LOOP;

	INSERT INTO "event" (
		id, user_id, entity_id, event_schema_slug, event_schema_plugin_id, session_entity_id,
		properties, created_at, occurred_at, order_created_at, order_key
	)
	SELECT * FROM _seen_completion_outputs
	ON CONFLICT DO NOTHING;

	${buildAbortOnRowsSql({
		countVariable: "invalid_rows",
		sampleVariable: "invalid_sample",
		message:
			"seen parent completion evidence: % inferred output/evidence row(s) have conflicting deterministic identity or content: %. The phase has been rolled back. Keep the dump and report the migration conflict; do not discard explicit history to bypass it.",
		source: `SELECT intended.id AS label FROM _seen_completion_outputs intended
			LEFT JOIN "event" actual ON actual.id = intended.id
			WHERE actual.id IS NULL OR actual.user_id IS DISTINCT FROM intended.user_id
				OR actual.entity_id IS DISTINCT FROM intended.entity_id
				OR actual.event_schema_slug IS DISTINCT FROM intended.event_schema_slug
				OR actual.event_schema_plugin_id IS DISTINCT FROM intended.event_schema_plugin_id
				OR actual.session_entity_id IS DISTINCT FROM intended.session_entity_id
				OR actual.properties IS DISTINCT FROM intended.properties
				OR actual.created_at IS DISTINCT FROM intended.created_at
				OR actual.occurred_at IS DISTINCT FROM intended.occurred_at
				OR actual.order_created_at IS DISTINCT FROM intended.order_created_at
				OR actual.order_key IS DISTINCT FROM intended.order_key`,
	})}

	${buildAbortOnRowsSql({
		countVariable: "invalid_rows",
		sampleVariable: "invalid_sample",
		message:
			"seen -> event: % migrated show or podcast lifecycle event(s) belong to a watch session other than the title itself, which would file them under the wrong session: %. This is a defect in this migration's session assignment rather than in the legacy data. Keep the dump and report it; retrying will not change the result.",
		source: `
			SELECT ev.id || ' (' || parent.name || ', ' || ev.event_schema_slug || ')' AS label
			FROM "event" ev
			INNER JOIN "entity" parent ON parent.id = ev.entity_id
			WHERE parent.entity_schema_slug IN ('show', 'podcast')
			  AND parent.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
			  AND ev.event_schema_slug IN ('backlog', 'complete', 'dropped', 'on_hold')
			  AND ev.event_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
			  AND ev.session_entity_id IS DISTINCT FROM ev.entity_id
		`,
	})}

	${buildAbortOnRowsSql({
		countVariable: "invalid_rows",
		sampleVariable: "invalid_sample",
		message:
			"seen -> event: % migrated progress event(s) are attached to a show or podcast itself rather than to one of its episodes, and V2 records episodic progress only on episodes: %. This is a defect in this migration's progress step rather than in the legacy data. Keep the dump and report it; retrying will not change the result.",
		source: `
			SELECT ev.id || ' (' || parent.name || ')' AS label
			FROM "event" ev
			INNER JOIN "entity" parent ON parent.id = ev.entity_id
			WHERE parent.entity_schema_slug IN ('show', 'podcast')
			  AND parent.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
			  AND ev.event_schema_slug = 'progress'
			  AND ev.event_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		`,
	})}

	IF EXISTS (
		SELECT 1
		FROM "event" ev
		INNER JOIN "entity" episode
			ON episode.id = ev.entity_id
			AND episode.entity_schema_slug = 'show-episode'
			AND episode.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		INNER JOIN "relationship" season_episode_rel
			ON season_episode_rel.target_entity_id = episode.id
			AND season_episode_rel.relationship_schema_slug = 'show-season-to-show-episode'
			AND season_episode_rel.relationship_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		INNER JOIN "entity" season
			ON season.id = season_episode_rel.source_entity_id
			AND season.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		INNER JOIN "relationship" show_season_rel
			ON show_season_rel.target_entity_id = season.id
			AND show_season_rel.relationship_schema_slug = 'show-to-show-season'
			AND show_season_rel.relationship_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		WHERE ev.event_schema_slug IN ('progress', 'complete')
		  AND ev.event_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		  AND (
			((season.properties ->> 'seasonNumber')::int > 0
				AND ev.session_entity_id IS DISTINCT FROM show_season_rel.source_entity_id)
			OR ((season.properties ->> 'seasonNumber')::int = 0
				AND ev.session_entity_id IS NOT NULL)
		  )
	) THEN
		RAISE EXCEPTION 'seen -> event: a migrated show episode event belongs to the wrong watch session. Episodes in a numbered season must sit in their show''s session and specials (season 0) must sit in none. This is a defect in this migration''s session assignment rather than in the legacy data. Keep the dump and report it; retrying will not change the result.';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "event" ev
		INNER JOIN "entity" episode
			ON episode.id = ev.entity_id
			AND episode.entity_schema_slug = 'podcast-episode'
			AND episode.entity_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		INNER JOIN "relationship" podcast_episode_rel
			ON podcast_episode_rel.target_entity_id = episode.id
			AND podcast_episode_rel.relationship_schema_slug = 'podcast-to-podcast-episode'
			AND podcast_episode_rel.relationship_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		WHERE ev.event_schema_slug IN ('progress', 'complete')
		  AND ev.event_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
		  AND ev.session_entity_id IS DISTINCT FROM podcast_episode_rel.source_entity_id
	) THEN
		RAISE EXCEPTION 'seen -> event: a migrated podcast episode event belongs to a watch session other than its own podcast. This is a defect in this migration''s session assignment rather than in the legacy data. Keep the dump and report it; retrying will not change the result.';
	END IF;

	${buildReportSql("seen parent completion evidence", [
		{
			count: "show_podcast_complete_inserted",
			message: "show/podcast parent complete events backfilled",
		},
	])}
END $$;
`;
