import { sql } from "drizzle-orm";

import type { DbClient } from "~/lib/db";

import { shouldRunLegacyBootstrap } from "./shared";

const renameLegacyTablesSql = sql`
DO $$
BEGIN
 	IF to_regclass('"old_user"') IS NULL
 		AND EXISTS (
 			SELECT 1
 			FROM information_schema.columns
 			WHERE table_name = 'user'
 				AND column_name = 'lot'
 		)
	THEN
		ALTER TABLE "user" RENAME TO old_user;
		ALTER TABLE "old_user" RENAME CONSTRAINT "user_pkey" TO "old_user_pkey";
		ALTER INDEX IF EXISTS "user__oidc_issuer_id__index" RENAME TO "old_user__oidc_issuer_id__index";
		ALTER INDEX IF EXISTS "user_is_disabled_idx" RENAME TO "old_user_is_disabled_idx";
		ALTER INDEX IF EXISTS "user_name_trigram_idx" RENAME TO "old_user_name_trigram_idx";
	END IF;
END $$;
`;

export const renameLegacyTables = async (database: DbClient) => {
	if (!(await shouldRunLegacyBootstrap(database))) {
		return;
	}

	await database.execute(renameLegacyTablesSql);
};
