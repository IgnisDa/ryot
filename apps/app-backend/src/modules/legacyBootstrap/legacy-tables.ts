import { sql } from "drizzle-orm";

import type { DbClient } from "~/lib/db";

const renameLegacyTablesSql = sql`
DO $$
BEGIN
	IF to_regclass('public.old_user') IS NULL
		AND EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public'
				AND table_name = 'user'
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

const migrateLegacyTablesSql = sql`
DO $$
BEGIN
	IF to_regclass('public.old_user') IS NULL THEN
		RETURN;
	END IF;

	WITH legacy_users AS (
		SELECT
			old_user.id,
			old_user.name,
			old_user.preferences,
			old_user.created_on,
			old_user.last_login_on,
			nullif(regexp_replace(lower(old_user.name), '[^a-z0-9._%+-]+', '', 'g'), '') AS email_local_part,
			count(*) OVER (
				PARTITION BY nullif(regexp_replace(lower(old_user.name), '[^a-z0-9._%+-]+', '', 'g'), '')
			) AS email_local_part_count
		FROM old_user
	)
	INSERT INTO "user" (
		"id",
		"name",
		"email",
		"preferences",
		"email_verified",
		"created_at",
		"updated_at"
	)
	SELECT
		legacy_users.id,
		legacy_users.name,
		CASE
			WHEN legacy_users.email_local_part_count > 1 AND legacy_users.email_local_part IS NOT NULL THEN
				legacy_users.email_local_part || '+' || legacy_users.id || '@ryot.local'
			ELSE
				COALESCE(legacy_users.email_local_part, legacy_users.id) || '@ryot.local'
		END,
		jsonb_build_object(
			'isNsfw', COALESCE((legacy_users.preferences -> 'general' ->> 'display_nsfw')::boolean, false),
			'languages', jsonb_build_object(
				'providers', COALESCE(
					(
						SELECT jsonb_agg(
							jsonb_build_object(
								'source', provider.value ->> 'source',
								'preferredLanguage', provider.value ->> 'preferred_language'
							)
							ORDER BY provider.ordinality
						)
						FROM jsonb_array_elements(
							COALESCE(legacy_users.preferences -> 'languages' -> 'providers', '[]'::jsonb)
						) WITH ORDINALITY AS provider(value, ordinality)
					),
					'[]'::jsonb
				)
			)
		),
		true,
		legacy_users.created_on,
		COALESCE(legacy_users.last_login_on, legacy_users.created_on)
	FROM legacy_users
	ON CONFLICT ("id") DO NOTHING;
END $$;
`;

export const renameLegacyTables = async (database: DbClient) => {
	await database.execute(renameLegacyTablesSql);
};

export const migrateLegacyTables = async (database: DbClient) => {
	await database.execute(migrateLegacyTablesSql);
};
