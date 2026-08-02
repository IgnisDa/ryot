import { createOAuthAccountIssuer } from "@better-auth/core/db";

import type { QualifiedSchema } from "./migration-resolution";
import {
	buildRequireLegacyTableSql,
	buildReportSql,
	quoteNullableSqlString,
	quoteSqlString,
} from "./shared";

const legacyEmailRegex = quoteSqlString("^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$");
const legacyOidcAccountIdPrefix = quoteSqlString("legacy-oidc-account:");
const legacyOidcAccountIssuer = quoteSqlString(createOAuthAccountIssuer("oidc"));

export const buildLegacyUserLibraryMigrationSql = (libraryEntitySchema: QualifiedSchema) => `
INSERT INTO "entity" (
	"id",
	"name",
	"user_id",
	"properties",
	"entity_schema_slug",
	"entity_schema_plugin_id"
)
SELECT
	md5('legacy-library:' || migrated_user.id),
	'Media Library',
	migrated_user.id,
	'{}'::jsonb,
	${quoteSqlString(libraryEntitySchema.slug)},
	${quoteNullableSqlString(libraryEntitySchema.pluginId)}
FROM "user" migrated_user
INNER JOIN "old_user" legacy_user ON legacy_user.id = migrated_user.id
WHERE NOT EXISTS (
	SELECT 1
	FROM "entity" existing
	WHERE existing.user_id = migrated_user.id
		AND existing.entity_schema_slug = ${quoteSqlString(libraryEntitySchema.slug)}
		AND existing.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(libraryEntitySchema.pluginId)}
		AND existing.external_id IS NULL
		AND existing.provider_id IS NULL
)
ON CONFLICT ("id") DO NOTHING;
`;

export const buildLegacyUserAuthMigrationSql = () => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
	invalid_mixed_user_ids text;
	invalid_missing_user_ids text;
	invalid_oidc_user_ids text;
	duplicate_oidc_subject_ids text;
	missing_oidc_stub_user_ids text;
	unexpected_oidc_account_user_ids text;
	password_user_account_ids text;
BEGIN
	${buildRequireLegacyTableSql("old_user -> user", "old_user")}

	IF to_regclass('"account"') IS NULL THEN
		RAISE EXCEPTION 'old_user -> user: the V2 table "account" is missing, so migrated users would have no sign-in accounts. Drizzle creates it before this migration runs, so the schema step did not complete. This is a defect in the migration order rather than in the legacy data; keep the dump and report it.';
	END IF;

	SELECT string_agg(id, ', ' ORDER BY id)
	INTO invalid_mixed_user_ids
	FROM "old_user"
	WHERE nullif(btrim("password"), '') IS NOT NULL
		AND nullif(btrim("oidc_issuer_id"), '') IS NOT NULL;
	IF invalid_mixed_user_ids IS NOT NULL THEN
		RAISE EXCEPTION 'old_user -> user: these legacy users have both a password and an OIDC subject, and V2 stores exactly one sign-in method per user: %. Pick one method per user in the V1 database -- clear the password or clear oidc_issuer_id -- then start the server again.',
			invalid_mixed_user_ids;
	END IF;

	SELECT string_agg(id, ', ' ORDER BY id)
	INTO invalid_missing_user_ids
	FROM "old_user"
	WHERE nullif(btrim("password"), '') IS NULL
		AND nullif(btrim("oidc_issuer_id"), '') IS NULL;
	IF invalid_missing_user_ids IS NOT NULL THEN
		RAISE EXCEPTION 'old_user -> user: these legacy users have neither a password nor an OIDC subject, so V2 would leave them with no way to sign in: %. Give each of them a password or an OIDC subject in the V1 database, or delete them, then start the server again.',
			invalid_missing_user_ids;
	END IF;

	SELECT string_agg(id, ', ' ORDER BY id)
	INTO invalid_oidc_user_ids
	FROM "old_user"
	WHERE nullif(btrim("oidc_issuer_id"), '') IS NOT NULL
		AND lower("name") !~ ${legacyEmailRegex};
	IF invalid_oidc_user_ids IS NOT NULL THEN
		RAISE EXCEPTION 'old_user -> user: these legacy OIDC users have a name that is not an email address, and V2 identifies OIDC users by email: %. Set an email address as the name for these users in the V1 database, then start the server again.', invalid_oidc_user_ids;
	END IF;

	SELECT string_agg(oidc_subject, ', ' ORDER BY oidc_subject)
	INTO duplicate_oidc_subject_ids
	FROM (
		SELECT nullif(btrim("oidc_issuer_id"), '') AS oidc_subject
		FROM "old_user"
		WHERE nullif(btrim("oidc_issuer_id"), '') IS NOT NULL
		GROUP BY 1
		HAVING count(*) > 1
	) duplicate_oidc_subjects;
	IF duplicate_oidc_subject_ids IS NOT NULL THEN
		RAISE EXCEPTION 'old_user -> user: these OIDC subjects are shared by more than one legacy user, so V2 cannot give each user a distinct sign-in account: %. Keep one user per subject in the V1 database, or clear oidc_issuer_id on the duplicates, then start the server again.',
			duplicate_oidc_subject_ids;
	END IF;

	WITH classified_users AS (
		SELECT
			old_user.id,
			old_user.name,
			old_user.is_disabled,
			old_user.preferences,
			old_user.created_on,
			old_user.last_login_on,
			CASE
				WHEN lower(old_user.name) ~ ${legacyEmailRegex}
				THEN lower(old_user.name)
				ELSE COALESCE(nullif(regexp_replace(lower(old_user.name), '[^a-z0-9._%+-]+', '', 'g'), ''), old_user.id) || '@ryot.local'
			END AS base_email
		FROM old_user
	),
	legacy_users AS (
		SELECT
			*,
			count(*) OVER (PARTITION BY base_email) AS base_email_count
		FROM classified_users
	)
	INSERT INTO "user" (
		"id",
		"name",
		"email",
		"disabled_at",
		"preferences",
		"email_verified",
		"created_at",
		"updated_at"
	)
	SELECT
		legacy_users.id,
		legacy_users.name,
		CASE
			WHEN legacy_users.base_email_count = 1 THEN legacy_users.base_email
			ELSE split_part(legacy_users.base_email, '@', 1) || '+' || legacy_users.id || '@' || split_part(legacy_users.base_email, '@', 2)
		END,
		CASE
			WHEN legacy_users.is_disabled THEN COALESCE(legacy_users.last_login_on, legacy_users.created_on + interval '90 days')
			ELSE NULL
		END,
		jsonb_build_object(
			'allowNsfw', COALESCE((legacy_users.preferences -> 'general' ->> 'display_nsfw')::boolean, true),
			'disableIntegrations', COALESCE(
				(legacy_users.preferences -> 'general' ->> 'disable_integrations')::boolean,
				false
			),
			'language', NULL
		),
		true,
		legacy_users.created_on,
		COALESCE(legacy_users.last_login_on, legacy_users.created_on)
	FROM legacy_users
	ON CONFLICT ("id") DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	${buildReportSql("old_user -> user", [{ count: "rows_inserted", message: "row(s) migrated" }])}

	WITH oidc_users AS (
		SELECT
			old_user.id,
			old_user.created_on,
			old_user.last_login_on,
			nullif(btrim(old_user."oidc_issuer_id"), '') AS legacy_oidc_subject
		FROM old_user
		WHERE nullif(btrim(old_user."oidc_issuer_id"), '') IS NOT NULL
	)
	INSERT INTO "account" (
		"id",
		"user_id",
		"issuer",
		"account_id",
		"provider_id",
		"password",
		"access_token",
		"refresh_token",
		"id_token",
		"scope",
		"access_token_expires_at",
		"refresh_token_expires_at",
		"created_at",
		"updated_at"
	)
	SELECT
		md5(${legacyOidcAccountIdPrefix} || oidc_users.id),
		oidc_users.id,
		${legacyOidcAccountIssuer},
		oidc_users.legacy_oidc_subject,
		'oidc',
		NULL,
		NULL,
		NULL,
		NULL,
		NULL,
		NULL,
		NULL,
		oidc_users.created_on,
		COALESCE(oidc_users.last_login_on, oidc_users.created_on)
	FROM oidc_users
	ON CONFLICT ("id") DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	${buildReportSql("old_user -> account", [{ count: "rows_inserted", message: "row(s) migrated" }])}

	SELECT string_agg(ou.id, ', ' ORDER BY ou.id)
	INTO missing_oidc_stub_user_ids
	FROM "old_user" ou
	WHERE nullif(btrim(ou."oidc_issuer_id"), '') IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM "account" a
			WHERE a."id" = md5(${legacyOidcAccountIdPrefix} || ou.id)
				AND a."user_id" = ou.id
				AND a."issuer" = ${legacyOidcAccountIssuer}
				AND a."account_id" = btrim(ou."oidc_issuer_id")
				AND a."provider_id" = 'oidc'
				AND a."password" IS NULL
		);
	IF missing_oidc_stub_user_ids IS NOT NULL THEN
		RAISE EXCEPTION 'old_user -> user: these legacy OIDC users did not receive the sign-in account this migration creates for them, so they would be unable to sign in: %. This is a defect in this migration rather than in the legacy data. Keep the dump and report it; retrying will not change the result.',
			missing_oidc_stub_user_ids;
	END IF;

	SELECT string_agg(ou.id, ', ' ORDER BY ou.id)
	INTO unexpected_oidc_account_user_ids
	FROM "old_user" ou
	WHERE nullif(btrim(ou."oidc_issuer_id"), '') IS NOT NULL
		AND EXISTS (
			SELECT 1
			FROM "account" a
			WHERE a."user_id" = ou.id
				AND a."id" <> md5(${legacyOidcAccountIdPrefix} || ou.id)
		);
	IF unexpected_oidc_account_user_ids IS NOT NULL THEN
		RAISE EXCEPTION 'old_user -> user: these legacy OIDC users received more than one sign-in account, and V2 expects exactly one: %. This is a defect in this migration rather than in the legacy data. Keep the dump and report it; retrying will not change the result.',
			unexpected_oidc_account_user_ids;
	END IF;

	SELECT string_agg(ou.id, ', ' ORDER BY ou.id)
	INTO password_user_account_ids
	FROM "old_user" ou
	WHERE nullif(btrim(ou."password"), '') IS NOT NULL
		AND EXISTS (
			SELECT 1
			FROM "account" a
			WHERE a."user_id" = ou.id
		);
	IF password_user_account_ids IS NOT NULL THEN
		RAISE EXCEPTION 'old_user -> user: these legacy password users received an OIDC sign-in account, which only OIDC users should have: %. This is a defect in this migration rather than in the legacy data. Keep the dump and report it; retrying will not change the result.',
			password_user_account_ids;
	END IF;

	${buildReportSql("old_user auth-state", [{ message: "migration finished" }])}
END $$;
`;
