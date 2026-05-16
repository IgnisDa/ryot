import { Effect } from "effect";

import {
	buildReportSql,
	getLatestReportSequence,
	legacyBootstrapGate,
	logReportRows,
	withReservedConnection,
} from "./shared";

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
	DROP TABLE IF EXISTS "old_notification_platform" CASCADE;
	DROP TABLE IF EXISTS "old_entity_translation" CASCADE;
	DROP TABLE IF EXISTS "application_cache" CASCADE;
	${buildReportSql("drop legacy tables", [{ message: "legacy tables dropped" }])}
END $$;
`;

export const dropLegacyTables = Effect.gen(function* () {
	const gate = yield* legacyBootstrapGate;
	if (!gate) {
		return;
	}

	yield* withReservedConnection((connection) =>
		Effect.gen(function* () {
			const reportSequence = yield* getLatestReportSequence(connection);
			yield* connection.executeRaw(dropLegacyTablesSql, []);
			yield* logReportRows(connection, reportSequence);
		}),
	);
});
