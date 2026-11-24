import { quoteSqlString } from "./shared";

export const historyHandoffTable = "legacy_history_handoff";

export const isoUtcSql = (timestamp: string) =>
	`to_char((${timestamp}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// `candidates` yields `legacy_record_id`, `user_id`, `parent_entity_id` and a Media history `event`
// for records whose parent lacks the episode or season they name. Those on a global provider parent of
// an enabled user stay in `stagedTable` for the phase's reports and in the handoff table until their
// import runs are admitted. Clearing `populated_at` makes that import's population an initial one,
// which fetches the parent's current episode list from its provider.
export const buildHistoryHandoffStagingSql = (input: {
	candidates: string;
	stagedTable: string;
	kind: "seen" | "review";
}) => `
	CREATE TABLE IF NOT EXISTS "${historyHandoffTable}" (
		"legacy_kind" text NOT NULL,
		"legacy_record_id" text NOT NULL,
		"user_id" text NOT NULL,
		"plugin_id" text NOT NULL,
		"parent_entity_id" text NOT NULL,
		"title" text NOT NULL,
		"external_id" text NOT NULL,
		"provider_slug" text NOT NULL,
		"entity_schema_slug" text NOT NULL,
		"event" jsonb NOT NULL,
		PRIMARY KEY ("legacy_kind", "legacy_record_id")
	);

	CREATE TEMP TABLE ${input.stagedTable} ON COMMIT DROP AS
	SELECT
		candidate.legacy_record_id, candidate.user_id, candidate.event,
		parent.id AS parent_entity_id, parent.name AS title, parent.external_id,
		parent.entity_schema_slug, parent.entity_schema_plugin_id AS plugin_id,
		provider.slug AS provider_slug
	FROM (${input.candidates}) candidate
	INNER JOIN "entity" parent ON parent.id = candidate.parent_entity_id
		AND parent.user_id IS NULL AND parent.external_id IS NOT NULL
	INNER JOIN "sandbox_provider" provider ON provider.id = parent.provider_id
	INNER JOIN "user" owner ON owner.id = candidate.user_id AND owner.disabled_at IS NULL;

	INSERT INTO "${historyHandoffTable}" (
		"legacy_kind", "legacy_record_id", "user_id", "plugin_id", "parent_entity_id", "title",
		"external_id", "provider_slug", "entity_schema_slug", "event"
	)
	SELECT ${quoteSqlString(input.kind)}, legacy_record_id, user_id, plugin_id, parent_entity_id,
		title, external_id, provider_slug, entity_schema_slug, event
	FROM ${input.stagedTable}
	ON CONFLICT DO NOTHING;

	UPDATE "entity" SET "populated_at" = NULL
	WHERE "populated_at" IS NOT NULL
		AND "id" IN (SELECT parent_entity_id FROM ${input.stagedTable});
`;
