import { REMINDER_MESSAGE_MAX_LENGTH } from "@ryot-app/contract/modules/reminders/schemas";

import {
	buildAbortOnRowsSql,
	buildReportSql,
	buildRequireLegacyTableSql,
	quoteSqlString,
} from "./shared";

const phase = "Reminders collection -> needs scheduling";
const memberships = `
	SELECT membership.*, collection.user_id
	FROM "collection_to_entity" membership
	JOIN "collection" collection ON collection.id = membership.collection_id
	WHERE collection.name = 'Reminders'
`;

export const buildReminderMigrationSql = () => `
DO $$
DECLARE
	invalid_count bigint;
	invalid_sample text;
	inactive_count bigint;
	inserted_count bigint;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql(phase, "collection")}
	${buildRequireLegacyTableSql(phase, "collection_to_entity")}
	IF EXISTS (SELECT 1 FROM "migration_report" WHERE phase = ${quoteSqlString(phase)}) THEN
		RETURN;
	END IF;

	${buildAbortOnRowsSql({
		countVariable: "invalid_count",
		sampleVariable: "invalid_sample",
		message: `${phase}: % membership(s) have malformed reminder text/date, a missing owner/target, or a target owned by another user (membership IDs: %). Correct the named memberships in the V1 database and restore its dump again. Dates must be YYYY-MM-DD and messages must contain 1-${REMINDER_MESSAGE_MAX_LENGTH} nonblank characters. No time or timezone can be inferred.`,
		source: `SELECT membership.id::text AS label FROM (${memberships}) membership
			LEFT JOIN "user" owner ON owner.id = membership.user_id
			LEFT JOIN "entity" target ON target.id = membership.entity_id
			WHERE membership.information IS NOT NULL AND (
				owner.id IS NULL OR target.id IS NULL
				OR (target.user_id IS NOT NULL AND target.user_id <> membership.user_id)
				OR (jsonb_typeof(membership.information) = 'object'
					AND jsonb_typeof(membership.information -> 'text') = 'string'
					AND length(btrim(membership.information ->> 'text')) > 0
					AND length(membership.information ->> 'text') + length(regexp_replace(membership.information ->> 'text', U&'[^\\+010000-\\+10FFFF]', '', 'g')) <= ${REMINDER_MESSAGE_MAX_LENGTH}
					AND jsonb_typeof(membership.information -> 'reminder') = 'string'
					AND CASE WHEN membership.information ->> 'reminder' ~ '^\\d{4}-\\d{2}-\\d{2}$'
						AND pg_input_is_valid(membership.information ->> 'reminder', 'date')
						THEN to_char((membership.information ->> 'reminder')::date, 'YYYY-MM-DD') = membership.information ->> 'reminder'
						ELSE false END) IS NOT TRUE
			)`,
	})}

	${buildAbortOnRowsSql({
		countVariable: "invalid_count",
		sampleVariable: "invalid_sample",
		source: `SELECT membership.id::text AS label FROM (${memberships}) membership
			JOIN "reminder" reminder ON reminder.id = 'reminder_' || md5(membership.id::text || ':entity-reminder')
			WHERE membership.information IS NOT NULL`,
		message: `${phase}: % deterministic reminder ID(s) already exist without a committed conversion report (membership IDs: %). This is an unexpected identity conflict. Keep this database and the original dump and report the migration defect; existing reminders were not replaced.`,
	})}

	INSERT INTO "reminder" (
		id, user_id, account_generation, entity_id, entity_title, message,
		state, original_schedule, created_at, updated_at
	)
	SELECT 'reminder_' || md5(membership.id::text || ':entity-reminder'), membership.user_id,
		owner.account_generation, target.id, target.name, membership.information ->> 'text',
		'needs-scheduling', jsonb_build_object('date', membership.information ->> 'reminder',
			'dueAt', NULL, 'timezone', NULL, 'mayHaveSent', false), membership.created_on, membership.last_updated_on
	FROM (${memberships}) membership
	JOIN "user" owner ON owner.id = membership.user_id
	JOIN "entity" target ON target.id = membership.entity_id
	WHERE membership.information IS NOT NULL;
	GET DIAGNOSTICS inserted_count = ROW_COUNT;
	SELECT count(*) INTO inactive_count FROM (${memberships}) membership WHERE membership.information IS NULL;
	${buildReportSql(phase, [
		{
			count: "inserted_count",
			message: "date-only reminder(s) imported as Needs scheduling; no delivery work created",
		},
		{
			count: "inactive_count",
			message:
				"membership(s) with absent reminder information left as inert collection data, matching the V1 worker",
		},
	])}
END $$;
`;
