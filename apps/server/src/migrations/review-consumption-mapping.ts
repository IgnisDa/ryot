import { mediaReviewConsumptionSlugs } from "@ryot-app/media-plugin/shared/media-review-operations";

import {
	buildAnomalyReportSql,
	buildReportDetailSql,
	buildReportSql,
	buildRequireLegacyTableSql,
	quoteSqlString,
} from "./shared";

const reviewConsumptionPhase = "seen review -> review consumption";

const seenEventIdsSql = (seen: string) =>
	["baseline", "episode-complete", "t"]
		.map((suffix) => `md5(${seen}.id || ${quoteSqlString(`:${suffix}`)})`)
		.join(", ");

const sharedReviewDetailSql = buildReportDetailSql({
	key: "u.seen_id",
	label: "u.entity_name",
	provenance: [
		["Title", "u.entity_name"],
		["Review", "u.review_id"],
		["Legacy row", "u.seen_id"],
		["User", "u.user_id"],
	],
	sentence: `format(
		'This record named the same review as a later finished record, so the review is about %s instead.',
		u.winner_seen_id)`,
});

// Runs after reviews and seen history. Seen rows keep deterministic event IDs, so each candidate is
// the migrated completion, progress or status event of that row on the review's own entity.
export const buildReviewConsumptionMigrationSql = (mediaPluginId: string) => `
DO $$
DECLARE
	linked_rows int := 0;
	shared_rows int := 0;
	report_seq int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql(reviewConsumptionPhase, "seen")}
	IF EXISTS (
		SELECT 1 FROM "migration_report" WHERE phase = ${quoteSqlString(reviewConsumptionPhase)}
	) THEN
		RETURN;
	END IF;

	CREATE TEMP TABLE _review_consumption_candidates ON COMMIT DROP AS
	SELECT
		s.id AS seen_id,
		s.user_id,
		review.id AS review_id,
		entity.name AS entity_name,
		candidate.id AS event_id,
		row_number() OVER (
			PARTITION BY review.id
			ORDER BY s.finished_on DESC NULLS LAST, s.id DESC
		) AS rank
	FROM "seen" s
	INNER JOIN "event" review
		ON review.id = s.review_id
		AND review.user_id = s.user_id
		AND review.event_schema_slug = 'review'
		AND review.event_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
	INNER JOIN "entity" entity ON entity.id = review.entity_id
	INNER JOIN LATERAL (
		SELECT event.id FROM "event" event
		WHERE event.id IN (${seenEventIdsSql("s")})
			AND event.user_id = s.user_id
			AND event.entity_id = review.entity_id
			AND event.event_schema_plugin_id = ${quoteSqlString(mediaPluginId)}
			AND event.event_schema_slug IN (${mediaReviewConsumptionSlugs.map(quoteSqlString).join(", ")})
		ORDER BY CASE event.event_schema_slug
			WHEN 'complete' THEN 0 WHEN 'item-complete' THEN 0
			WHEN 'dropped' THEN 1 WHEN 'on_hold' THEN 1 ELSE 2 END
		LIMIT 1
	) candidate ON true
	WHERE s.review_id IS NOT NULL;

	UPDATE "event" review
	SET properties = review.properties || jsonb_build_object('consumptionEventId', winner.event_id)
	FROM _review_consumption_candidates winner
	WHERE winner.rank = 1 AND review.id = winner.review_id;
	GET DIAGNOSTICS linked_rows = ROW_COUNT;

	INSERT INTO "event_reference" (referencing_event_id, property, referenced_event_id)
	SELECT review_id, 'consumptionEventId', event_id
	FROM _review_consumption_candidates WHERE rank = 1;

	CREATE TEMP TABLE _review_consumption_shared ON COMMIT DROP AS
	SELECT loser.seen_id, loser.user_id, loser.review_id, loser.entity_name,
		winner.seen_id AS winner_seen_id
	FROM _review_consumption_candidates loser
	INNER JOIN _review_consumption_candidates winner
		ON winner.review_id = loser.review_id AND winner.rank = 1
	WHERE loser.rank > 1;

	${buildAnomalyReportSql({
		seqVariable: "report_seq",
		countVariable: "shared_rows",
		phase: reviewConsumptionPhase,
		detail: sharedReviewDetailSql,
		code: "review-consumption-shared",
		source: "_review_consumption_shared u",
		message:
			"Some reviews were named by more than one watch or read. Each review is now about its latest finished record; the other records are listed below and keep no link to the review.",
	})}

	${buildReportSql(reviewConsumptionPhase, [
		{ count: "linked_rows", message: "review(s) linked to the record they are about" },
	])}
END $$;
`;
