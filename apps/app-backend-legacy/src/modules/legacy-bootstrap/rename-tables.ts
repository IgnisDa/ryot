import type { DbClient } from "~/lib/db";

import { shouldRunLegacyBootstrap, withLegacyBootstrapNoticeClient } from "./shared";

const renameLegacyUserTableSql = `
DO $$
DECLARE started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"old_user"') IS NOT NULL THEN
		-- rename already ran on a previous startup; skip idempotently
		RETURN;
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_name = 'user'
			AND column_name = 'lot'
	) THEN
		RAISE EXCEPTION 'Expected V1 user table with a lot column but it was not found; cannot rename';
	END IF;

	ALTER TABLE "user" RENAME TO old_user;
	ALTER TABLE "old_user" RENAME CONSTRAINT "user_pkey" TO "old_user_pkey";
	ALTER INDEX IF EXISTS "user__oidc_issuer_id__index" RENAME TO "old_user__oidc_issuer_id__index";
	ALTER INDEX IF EXISTS "user_is_disabled_idx" RENAME TO "old_user_is_disabled_idx";
	ALTER INDEX IF EXISTS "user_name_trigram_idx" RENAME TO "old_user_name_trigram_idx";
	RAISE NOTICE 'rename: user -> old_user (constraints and indexes updated, % seconds elapsed)',
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

// The V2 "integration" table reuses the V1 table name, so the V1 table must be moved aside before
// the Drizzle migration creates the V2 "integration" table (its CREATE TABLE has no IF NOT EXISTS).
// The legacy primary key is renamed too because its backing index name would otherwise collide with
// the V2 table's "integration_pkey" index.
const renameLegacyIntegrationTableSql = `
DO $$
DECLARE started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"old_integration"') IS NOT NULL THEN
		-- rename already ran on a previous startup; skip idempotently
		RETURN;
	END IF;

	IF to_regclass('"integration"') IS NULL THEN
		RAISE EXCEPTION 'Expected V1 integration table to exist but it was not found; cannot rename';
	END IF;

	ALTER TABLE "integration" RENAME TO old_integration;
	ALTER TABLE "old_integration" RENAME CONSTRAINT "integration_pkey" TO "old_integration_pkey";
	RAISE NOTICE 'rename: integration -> old_integration (% seconds elapsed)',
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

export const renameLegacyTables = async (database: DbClient) => {
	if (!(await shouldRunLegacyBootstrap(database))) {
		return;
	}

	await withLegacyBootstrapNoticeClient(database, async (client) => {
		await client.query(renameLegacyUserTableSql);
		await client.query(renameLegacyIntegrationTableSql);
	});
};
