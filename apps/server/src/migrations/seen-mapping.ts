import {
	buildEpisodeAbsentDetailSql,
	buildEpisodeAmbiguousDetailSql,
	buildEpisodeMalformedDetailSql,
	buildEpisodeResolutionFallbackSql,
} from "./episode-resolution-sql";
import {
	buildSeenConsumptionFactsSql,
	seenConsumptionPropertiesSql,
} from "./seen-consumption-mapping";
import {
	buildAbortOnRowsSql,
	buildAnomalyReportSql,
	buildReportSql,
	buildRequireLegacyTableSql,
	quoteSqlString,
} from "./shared";

const seenReportPhase = "seen -> event";

export const buildSeenMigrationSql = (mediaPluginId: string) => `
DO $$
DECLARE
	batch_size constant int := 500;
	cursor_id text := '';
	next_cursor_id text;
	prog_inserted int := 0;
	complete_inserted int := 0;
	item_inserted int := 0;
	term_inserted int := 0;
	unresolved_absent_rows int := 0;
	unresolved_ambiguous_rows int := 0;
	unresolved_malformed_rows int := 0;
	report_seq int;
	invalid_source_rows int;
	invalid_source_sample text;
	batch_count int;
	index_rec record;
	index_statement text;
	index_statements text[] := ARRAY[]::text[];
	constraint_rec record;
	constraint_statement text;
	constraint_statements text[] := ARRAY[]::text[];
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql(seenReportPhase, "seen")}
	IF EXISTS (
		SELECT 1 FROM "migration_report"
		WHERE phase = 'seen -> event'
	) THEN
		RETURN;
	END IF;

	${buildEpisodeResolutionFallbackSql(mediaPluginId)}
	${buildSeenConsumptionFactsSql(mediaPluginId)}
	CREATE TEMP TABLE _legacy_seen_events ON COMMIT DROP AS
	SELECT id, user_id, entity_id, event_schema_slug, event_schema_plugin_id,
		session_entity_id, properties, created_at, occurred_at
	FROM "event" WITH NO DATA;
	CREATE UNIQUE INDEX ON _legacy_seen_events (id);

	FOR constraint_rec IN
		SELECT conname, pg_get_constraintdef(oid) AS definition
		FROM pg_constraint
		WHERE conrelid = '"event"'::regclass AND contype = 'f'
		ORDER BY conname
	LOOP
		constraint_statements := array_append(constraint_statements,
			format('ALTER TABLE "event" ADD CONSTRAINT %I %s', constraint_rec.conname, constraint_rec.definition));
		EXECUTE format('ALTER TABLE "event" DROP CONSTRAINT %I', constraint_rec.conname);
	END LOOP;

	FOR index_rec IN
		SELECT namespace.nspname, index_class.relname, pg_get_indexdef(index_class.oid) AS definition
		FROM pg_index index_entry
		INNER JOIN pg_class index_class ON index_class.oid = index_entry.indexrelid
		INNER JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
		WHERE index_entry.indrelid = '"event"'::regclass
			AND NOT index_entry.indisunique
			AND NOT EXISTS (
				SELECT 1 FROM pg_constraint constraint_entry
				WHERE constraint_entry.conindid = index_entry.indexrelid
			)
		ORDER BY index_class.relname
	LOOP
		index_statements := array_append(index_statements, index_rec.definition);
		EXECUTE format('DROP INDEX %I.%I', index_rec.nspname, index_rec.relname);
	END LOOP;

	LOOP
		SELECT max(seen_id) INTO next_cursor_id FROM (
			SELECT seen_id FROM _legacy_seen_consumption
			WHERE seen_id > cursor_id ORDER BY seen_id LIMIT batch_size
		) batch;
		EXIT WHEN next_cursor_id IS NULL;

		INSERT INTO _legacy_seen_events (
			"id", "user_id", "entity_id", "event_schema_slug", "event_schema_plugin_id",
			"session_entity_id", "properties", "created_at", "occurred_at"
		)
		SELECT
			md5(r.seen_id || ':baseline'), r.user_id,
			COALESCE(r.episode_entity_id, r.metadata_id), 'progress', ${quoteSqlString(mediaPluginId)},
			r.episode_session_id,
			${seenConsumptionPropertiesSql("r")} || jsonb_strip_nulls(jsonb_build_object(
				'progressPercent', CASE WHEN r.item_unit IS NULL AND r.progress > 0 THEN r.progress END,
				'mangaVolume', CASE WHEN r.item_unit = 'chapters' THEN r.source_volume::numeric END
			)),
			r.ordering_time, r.ordering_time
		FROM _legacy_seen_consumption r
		WHERE r.seen_id > cursor_id AND r.seen_id <= next_cursor_id
			AND NOT (r.state = 'completed' OR (r.state = 'in_progress' AND r.progress = 100))
			AND (r.state = 'in_progress' OR r.entity_schema_slug IN ('show', 'podcast'))
			AND (r.entity_schema_slug NOT IN ('show', 'podcast') OR r.episode_entity_id IS NOT NULL)
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_count = ROW_COUNT;
		prog_inserted := prog_inserted + batch_count;

		INSERT INTO _legacy_seen_events (
			"id", "user_id", "entity_id", "event_schema_slug", "event_schema_plugin_id",
			"session_entity_id", "properties", "created_at", "occurred_at"
		)
		SELECT
			md5(r.seen_id || CASE WHEN r.entity_schema_slug IN ('show', 'podcast')
				THEN ':episode-complete' ELSE ':t' END),
			r.user_id, COALESCE(r.episode_entity_id, r.metadata_id),
			CASE WHEN r.item_unit IS NOT NULL THEN 'item-complete' ELSE 'complete' END,
			${quoteSqlString(mediaPluginId)}, r.episode_session_id,
			CASE WHEN r.item_unit IS NOT NULL THEN
				(${seenConsumptionPropertiesSql("r")} - 'sourceProgress') || jsonb_build_object(
					'consumedItem', jsonb_strip_nulls(jsonb_build_object(
						'unit', r.item_unit,
						'position', COALESCE(r.source_position, r.source_volume)::numeric,
						'volume', CASE WHEN r.item_unit = 'chapters' THEN r.source_volume::numeric END
					))
				)
			ELSE ${seenConsumptionPropertiesSql("r")} END,
			r.ordering_time, COALESCE(r.finished_on, r.ordering_time)
		FROM _legacy_seen_consumption r
		WHERE r.seen_id > cursor_id AND r.seen_id <= next_cursor_id
			AND (r.state = 'completed' OR (r.state = 'in_progress' AND r.progress = 100))
			AND (r.entity_schema_slug NOT IN ('show', 'podcast') OR r.episode_entity_id IS NOT NULL)
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_count = ROW_COUNT;
		complete_inserted := complete_inserted + batch_count;

		INSERT INTO _legacy_seen_events (
			"id", "user_id", "entity_id", "event_schema_slug", "event_schema_plugin_id",
			"session_entity_id", "properties", "created_at", "occurred_at"
		)
		SELECT
			md5(r.seen_id || ':t'), r.user_id, r.metadata_id,
			CASE WHEN r.state = 'dropped' THEN 'dropped' ELSE 'on_hold' END,
			${quoteSqlString(mediaPluginId)},
			CASE WHEN r.entity_schema_slug IN ('show', 'podcast') THEN r.metadata_id END,
			CASE WHEN r.entity_schema_slug IN ('show', 'podcast') THEN
				jsonb_strip_nulls(jsonb_build_object(
					'consumptionBasis', jsonb_build_object('unit', 'episodes'),
					'dateUnknown', true, 'sourceRun', 'seen:' || r.seen_id,
					'consumedOn', r.consumed_on,
					'timeSpent', CASE WHEN r.episode_entity_id IS NULL THEN r.manual_time_spent / 60.0 END,
					'startedOn', to_char(r.started_on AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
				))
			ELSE ${seenConsumptionPropertiesSql("r")} || jsonb_strip_nulls(jsonb_build_object(
				'progressPercent', CASE WHEN r.item_unit IS NULL AND r.progress > 0 THEN r.progress END,
				'mangaVolume', CASE WHEN r.item_unit = 'chapters' THEN r.source_volume::numeric END
			)) END,
			r.ordering_time + interval '1 millisecond', r.ordering_time
		FROM _legacy_seen_consumption r
		WHERE r.seen_id > cursor_id AND r.seen_id <= next_cursor_id
			AND r.state IN ('dropped', 'on_a_hold')
		ON CONFLICT DO NOTHING;
		GET DIAGNOSTICS batch_count = ROW_COUNT;
		term_inserted := term_inserted + batch_count;
		cursor_id := next_cursor_id;
	END LOOP;

	${buildAbortOnRowsSql({
		countVariable: "invalid_source_rows",
		sampleVariable: "invalid_source_sample",
		message:
			"seen -> event: % numbered completed source row(s) did not produce exactly one independent item event: %. The phase has been rolled back. Keep the dump and report this migration defect; cumulative baselines and whole-title completions cannot replace item occurrences.",
		source: `SELECT source.seen_id AS label FROM _legacy_seen_consumption source
			LEFT JOIN _legacy_seen_events event ON event.properties ->> 'sourceRun' = 'seen:' || source.seen_id
			WHERE source.item_unit IS NOT NULL
				AND (source.state = 'completed' OR (source.state = 'in_progress' AND source.progress = 100))
			GROUP BY source.seen_id
			HAVING count(event.id) <> 1
				OR bool_or(event.event_schema_slug <> 'item-complete'
					OR event.properties ?| ARRAY['progressPercent', 'progressPages', 'animeEpisode',
						'mangaChapter', 'mangaVolume', 'completionKey', 'sourceProgress'])`,
	})}
	SELECT count(*) INTO item_inserted FROM _legacy_seen_events WHERE event_schema_slug = 'item-complete';
	complete_inserted := complete_inserted - item_inserted;

	INSERT INTO "event" (
		id, user_id, entity_id, event_schema_slug, event_schema_plugin_id,
		session_entity_id, properties, created_at, occurred_at
	)
	SELECT * FROM _legacy_seen_events
	ON CONFLICT DO NOTHING;

	FOREACH index_statement IN ARRAY index_statements LOOP
		EXECUTE index_statement;
	END LOOP;
	FOREACH constraint_statement IN ARRAY constraint_statements LOOP
		EXECUTE constraint_statement;
	END LOOP;
	ANALYZE "event";

	${buildAbortOnRowsSql({
		countVariable: "invalid_source_rows",
		sampleVariable: "invalid_source_sample",
		message:
			"seen -> event: % source fact row(s) have missing or conflicting deterministic output: %. The phase has been rolled back. Keep the dump and report this migration conflict; retrying the same build will not repair the mapping.",
		source: `
			SELECT intended.id AS label FROM _legacy_seen_events intended
			LEFT JOIN "event" actual ON actual.id = intended.id
			WHERE actual.id IS NULL OR actual.user_id IS DISTINCT FROM intended.user_id
				OR actual.entity_id IS DISTINCT FROM intended.entity_id
				OR actual.event_schema_slug IS DISTINCT FROM intended.event_schema_slug
				OR actual.event_schema_plugin_id IS DISTINCT FROM intended.event_schema_plugin_id
				OR actual.session_entity_id IS DISTINCT FROM intended.session_entity_id
				OR actual.properties IS DISTINCT FROM intended.properties
				OR actual.created_at IS DISTINCT FROM intended.created_at
				OR actual.occurred_at IS DISTINCT FROM intended.occurred_at
		`,
	})}

	CREATE TEMP TABLE _seen_unresolved_positions ON COMMIT DROP AS
	SELECT
		s.id AS legacy_record_id, s.user_id, e.id AS parent_entity_id,
		e.name AS parent_name, e.entity_schema_slug AS kind,
		CASE WHEN e.entity_schema_slug = 'show' THEN s.show_extra_information ->> 'season' END AS requested_season,
		CASE WHEN e.entity_schema_slug = 'show' THEN s.show_extra_information ->> 'episode'
			ELSE s.podcast_extra_information ->> 'episode' END AS requested_episode,
		COALESCE(show_coordinate.candidate_count, podcast_coordinate.candidate_count) AS candidate_count,
		COALESCE(inventory.available_summary, 'none') AS available_summary,
		EXISTS (
			SELECT 1 FROM _legacy_show_episode_coordinates season_probe
			WHERE season_probe.parent_entity_id = e.id
				AND season_probe.season_number = s.show_extra_information ->> 'season'
		) AS season_exists,
		CASE
			WHEN (e.entity_schema_slug = 'show' AND (
				COALESCE(s.show_extra_information ->> 'season', '') !~ '^[0-9]+$'
				OR COALESCE(s.show_extra_information ->> 'episode', '') !~ '^[0-9]+$'))
				OR (e.entity_schema_slug = 'podcast'
					AND COALESCE(s.podcast_extra_information ->> 'episode', '') !~ '^[0-9]+$') THEN 'malformed'
			WHEN COALESCE(show_coordinate.candidate_count, podcast_coordinate.candidate_count) > 1 THEN 'ambiguous'
			ELSE 'absent'
		END AS cause
	FROM "seen" s
	INNER JOIN "entity" e ON e.id = s.metadata_id
	INNER JOIN _legacy_seen_consumption facts ON facts.seen_id = s.id
	LEFT JOIN _legacy_show_episode_coordinates show_coordinate
		ON e.entity_schema_slug = 'show' AND show_coordinate.parent_entity_id = s.metadata_id
		AND show_coordinate.season_number = s.show_extra_information ->> 'season'
		AND show_coordinate.episode_number = s.show_extra_information ->> 'episode'
	LEFT JOIN _legacy_podcast_episode_coordinates podcast_coordinate
		ON e.entity_schema_slug = 'podcast' AND podcast_coordinate.parent_entity_id = s.metadata_id
		AND podcast_coordinate.episode_number = s.podcast_extra_information ->> 'episode'
	LEFT JOIN _legacy_episodic_inventory inventory ON inventory.parent_entity_id = e.id
	WHERE e.entity_schema_slug IN ('show', 'podcast') AND facts.episode_entity_id IS NULL;

	${buildAnomalyReportSql({
		phase: seenReportPhase,
		seqVariable: "report_seq",
		code: "seen-episode-absent",
		countVariable: "unresolved_absent_rows",
		detail: buildEpisodeAbsentDetailSql("this watch", "u"),
		source: "_seen_unresolved_positions u WHERE u.cause = 'absent'",
		message:
			"Some watch history was not carried over because the episode it was recorded against does not exist in the show or podcast's stored episode list. Each skipped watch is listed below with what the stored list actually contains.",
	})}
	${buildAnomalyReportSql({
		phase: seenReportPhase,
		seqVariable: "report_seq",
		code: "seen-episode-ambiguous",
		countVariable: "unresolved_ambiguous_rows",
		detail: buildEpisodeAmbiguousDetailSql("u"),
		source: "_seen_unresolved_positions u WHERE u.cause = 'ambiguous'",
		message:
			"Some watch history was not carried over because more than one stored episode claims the position it was recorded against, so there was no way to tell which episode was watched.",
	})}
	${buildAnomalyReportSql({
		phase: seenReportPhase,
		seqVariable: "report_seq",
		code: "seen-episode-malformed",
		countVariable: "unresolved_malformed_rows",
		detail: buildEpisodeMalformedDetailSql("u"),
		source: "_seen_unresolved_positions u WHERE u.cause = 'malformed'",
		message:
			"Some show and podcast watch history was not carried over because the legacy row did not record a usable episode number. Each skipped watch is listed below with the value that was actually stored.",
	})}

	${buildReportSql(seenReportPhase, [
		{ count: "prog_inserted", message: "undated cumulative baselines" },
		{ count: "complete_inserted", message: "independent source completions" },
		{ count: "item_inserted", message: "independent numbered item occurrences" },
		{ count: "term_inserted", message: "terminal status events" },
		{ message: "canonical seen source facts copied" },
	])}
END $$;
`;
