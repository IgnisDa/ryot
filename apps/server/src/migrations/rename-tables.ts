import { Effect } from "effect";

import { legacyBootstrapGate, withReservedConnection } from "./shared";

const renameLegacyUserTableSql = `
DO $$
BEGIN
	IF to_regclass('"old_user"') IS NOT NULL THEN RETURN; END IF;
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user' AND column_name = 'lot') THEN
		RAISE EXCEPTION 'rename legacy tables: the V1 "user" table has no "lot" column, so this does not look like a V1 database. Legacy tables are renamed before V2 tables are created, so the migration stops before touching anything. Restore a complete V1 dump, or drop "seaql_migrations" if this is not a V1 database, then start the server again.';
	END IF;
	ALTER TABLE "user" RENAME TO old_user;
	ALTER TABLE "old_user" RENAME CONSTRAINT "user_pkey" TO "old_user_pkey";
	ALTER INDEX IF EXISTS "user__oidc_issuer_id__index" RENAME TO "old_user__oidc_issuer_id__index";
	ALTER INDEX IF EXISTS "user_is_disabled_idx" RENAME TO "old_user_is_disabled_idx";
	ALTER INDEX IF EXISTS "user_name_trigram_idx" RENAME TO "old_user_name_trigram_idx";
END $$;
`;

const renameLegacyIntegrationTableSql = `
DO $$
BEGIN
	IF to_regclass('"old_integration"') IS NOT NULL THEN RETURN; END IF;
	IF to_regclass('"integration"') IS NULL THEN
		RAISE EXCEPTION 'rename legacy tables: the V1 "integration" table is missing, so integrations cannot be renamed out of the way before V2 tables are created. Restore a complete V1 dump, or drop "seaql_migrations" if this is not a V1 database, then start the server again.';
	END IF;
	ALTER TABLE "integration" RENAME TO old_integration;
	ALTER TABLE "old_integration" RENAME CONSTRAINT "integration_pkey" TO "old_integration_pkey";
END $$;
`;

const renameLegacyNotificationPlatformTableSql = `
DO $$
BEGIN
	IF to_regclass('"old_notification_platform"') IS NOT NULL THEN RETURN; END IF;
	IF to_regclass('"notification_platform"') IS NULL THEN
		RAISE EXCEPTION 'rename legacy tables: the V1 "notification_platform" table is missing, so notification platforms cannot be renamed out of the way before V2 tables are created. Restore a complete V1 dump, or drop "seaql_migrations" if this is not a V1 database, then start the server again.';
	END IF;
	ALTER TABLE "notification_platform" RENAME TO old_notification_platform;
	ALTER TABLE "old_notification_platform" RENAME CONSTRAINT "notification_platform_pkey" TO "old_notification_platform_pkey";
	ALTER INDEX IF EXISTS "notification_platform__user_id" RENAME TO "old_notification_platform__user_id";
END $$;
`;

const renameLegacyEntityTranslationTableSql = `
DO $$
BEGIN
	IF to_regclass('"old_entity_translation"') IS NOT NULL THEN RETURN; END IF;
	IF to_regclass('"entity_translation"') IS NULL THEN
		RAISE EXCEPTION 'rename legacy tables: the V1 "entity_translation" table is missing, so translations cannot be renamed out of the way before V2 tables are created. Restore a complete V1 dump, or drop "seaql_migrations" if this is not a V1 database, then start the server again.';
	END IF;
	ALTER TABLE "entity_translation" RENAME TO old_entity_translation;
	ALTER TABLE "old_entity_translation" RENAME CONSTRAINT "entity_translation_pkey" TO "old_entity_translation_pkey";
END $$;
`;

export const renameLegacyTables = Effect.gen(function* () {
	const gate = yield* legacyBootstrapGate;
	if (!gate) {
		return;
	}

	yield* withReservedConnection((connection) =>
		Effect.gen(function* () {
			yield* connection.executeRaw(renameLegacyUserTableSql, []);
			yield* connection.executeRaw(renameLegacyIntegrationTableSql, []);
			yield* connection.executeRaw(renameLegacyNotificationPlatformTableSql, []);
			yield* connection.executeRaw(renameLegacyEntityTranslationTableSql, []);
		}),
	);
});
