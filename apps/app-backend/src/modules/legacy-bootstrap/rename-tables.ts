import { Effect } from "effect";

import { legacyBootstrapGate, withRawPgClient } from "./shared";

const renameLegacyUserTableSql = `
DO $$
DECLARE started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"old_user"') IS NOT NULL THEN RETURN; END IF;
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user' AND column_name = 'lot') THEN
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

const renameLegacyIntegrationTableSql = `
DO $$
DECLARE started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"old_integration"') IS NOT NULL THEN RETURN; END IF;
	IF to_regclass('"integration"') IS NULL THEN
		RAISE EXCEPTION 'Expected V1 integration table to exist but it was not found; cannot rename';
	END IF;
	ALTER TABLE "integration" RENAME TO old_integration;
	ALTER TABLE "old_integration" RENAME CONSTRAINT "integration_pkey" TO "old_integration_pkey";
	RAISE NOTICE 'rename: integration -> old_integration (% seconds elapsed)',
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

export const renameLegacyTables = Effect.gen(function* () {
	const gate = yield* legacyBootstrapGate;
	if (!gate) {
		return;
	}

	yield* withRawPgClient((client) =>
		client
			.query(renameLegacyUserTableSql)
			.then(() => client.query(renameLegacyIntegrationTableSql)),
	);
});
