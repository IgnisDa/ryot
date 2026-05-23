import type { DbClient } from "~/lib/db";

import { shouldRunLegacyBootstrap, withLegacyBootstrapNoticeClient } from "./shared";

const dropLegacyTablesSql = `
DO $$
DECLARE started_at timestamptz := clock_timestamp();
BEGIN
	DROP TABLE IF EXISTS "seaql_migrations" CASCADE;
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
	DROP TABLE IF EXISTS "collection" CASCADE;
	RAISE NOTICE 'legacy tables dropped (% seconds elapsed)',
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

export const dropLegacyTables = async (database: DbClient) => {
	if (!(await shouldRunLegacyBootstrap(database))) {
		return;
	}

	await withLegacyBootstrapNoticeClient(database, async (client) => {
		await client.query(dropLegacyTablesSql);
	});
};
