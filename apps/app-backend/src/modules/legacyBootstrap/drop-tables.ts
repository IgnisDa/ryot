import type { DbClient } from "~/lib/db";

import { shouldRunLegacyBootstrap, withLegacyBootstrapNoticeClient } from "./shared";

const dropLegacyTablesSql = `
DO $$
BEGIN
	DROP TABLE IF EXISTS "seaql_migrations" CASCADE;
	DROP TABLE IF EXISTS "metadata_to_metadata_group" CASCADE;
	DROP TABLE IF EXISTS "metadata_group_to_person" CASCADE;
	DROP TABLE IF EXISTS "metadata_to_person" CASCADE;
	DROP TABLE IF EXISTS "metadata" CASCADE;
	DROP TABLE IF EXISTS "metadata_group" CASCADE;
	DROP TABLE IF EXISTS "person" CASCADE;
	DROP TABLE IF EXISTS "old_user" CASCADE;
	RAISE NOTICE 'legacy tables dropped';
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
