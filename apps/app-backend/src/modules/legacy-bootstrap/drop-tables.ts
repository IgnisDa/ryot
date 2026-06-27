import { Effect } from "effect";

import { legacyBootstrapGate, withRawPgClient } from "./shared";

const dropLegacyTablesSql = `
DO $$
DECLARE started_at timestamptz := clock_timestamp();
BEGIN
	DROP TABLE IF EXISTS "seaql_migrations" CASCADE;
	DROP TABLE IF EXISTS "metadata_to_metadata" CASCADE;
	DROP TABLE IF EXISTS "metadata_to_metadata_group" CASCADE;
	DROP TABLE IF EXISTS "metadata_group_to_person" CASCADE;
	DROP TABLE IF EXISTS "metadata_to_person" CASCADE;
	DROP TABLE IF EXISTS "metadata" CASCADE;
	DROP TABLE IF EXISTS "metadata_group" CASCADE;
	DROP TABLE IF EXISTS "person" CASCADE;
	DROP TABLE IF EXISTS "exercise" CASCADE;
	DROP TABLE IF EXISTS "workout" CASCADE;
	DROP TABLE IF EXISTS "workout_template" CASCADE;
	DROP TABLE IF EXISTS "old_user" CASCADE;
	DROP TABLE IF EXISTS "user_measurement" CASCADE;
	DROP TABLE IF EXISTS "seen" CASCADE;
	DROP TABLE IF EXISTS "collection_to_entity" CASCADE;
	DROP TABLE IF EXISTS "collection" CASCADE;
	DROP TABLE IF EXISTS "review" CASCADE;
	DROP TABLE IF EXISTS "user_to_entity" CASCADE;
	DROP TABLE IF EXISTS "old_integration" CASCADE;
	DROP TABLE IF EXISTS "notification_platform" CASCADE;
	RAISE NOTICE 'legacy tables dropped (% seconds elapsed)',
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

export const dropLegacyTables = Effect.gen(function* () {
	const gate = yield* legacyBootstrapGate;
	if (!gate) {
		return;
	}

	yield* withRawPgClient((client) => client.query(dropLegacyTablesSql));
});
