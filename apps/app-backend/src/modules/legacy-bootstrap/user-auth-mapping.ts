import { quoteSqlString } from "./shared";

const legacyEmailRegex = quoteSqlString("^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$");
const legacyOidcAccountIdPrefix = quoteSqlString("legacy-oidc-account:");

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
	IF to_regclass('"old_user"') IS NULL THEN
		RAISE EXCEPTION 'Expected old_user table to exist (created by renameLegacyTables) but it was not found';
	END IF;

	IF to_regclass('"account"') IS NULL THEN
		RAISE EXCEPTION 'Expected account table to exist but it was not found';
	END IF;

	SELECT string_agg(id, ', ' ORDER BY id)
	INTO invalid_mixed_user_ids
	FROM "old_user"
	WHERE nullif(btrim("password"), '') IS NOT NULL
		AND nullif(btrim("oidc_issuer_id"), '') IS NOT NULL;
	IF invalid_mixed_user_ids IS NOT NULL THEN
		RAISE EXCEPTION 'Legacy users with both a non-empty password and a non-empty OIDC subject are invalid: %',
			invalid_mixed_user_ids;
	END IF;

	SELECT string_agg(id, ', ' ORDER BY id)
	INTO invalid_missing_user_ids
	FROM "old_user"
	WHERE nullif(btrim("password"), '') IS NULL
		AND nullif(btrim("oidc_issuer_id"), '') IS NULL;
	IF invalid_missing_user_ids IS NOT NULL THEN
		RAISE EXCEPTION 'Legacy users with neither a non-empty password nor a non-empty OIDC subject are invalid: %',
			invalid_missing_user_ids;
	END IF;

	SELECT string_agg(id, ', ' ORDER BY id)
	INTO invalid_oidc_user_ids
	FROM "old_user"
	WHERE nullif(btrim("oidc_issuer_id"), '') IS NOT NULL
		AND lower("name") !~ ${legacyEmailRegex};
	IF invalid_oidc_user_ids IS NOT NULL THEN
		RAISE EXCEPTION 'Legacy OIDC users with invalid email-style names are invalid: %', invalid_oidc_user_ids;
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
		RAISE EXCEPTION 'Legacy users with duplicate OIDC subjects are invalid: %',
			duplicate_oidc_subject_ids;
	END IF;

	RAISE NOTICE 'old_user auth-state migration started (% seconds elapsed)', 0.0;

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
		"banned_at",
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
			'isNsfw', COALESCE((legacy_users.preferences -> 'general' ->> 'display_nsfw')::boolean, false),
			'disableIntegrations', COALESCE(
				(legacy_users.preferences -> 'general' ->> 'disable_integrations')::boolean,
				false
			),
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
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE 'old_user -> user: % row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);

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
	RAISE NOTICE 'old_user -> account: % row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);

	SELECT string_agg(ou.id, ', ' ORDER BY ou.id)
	INTO missing_oidc_stub_user_ids
	FROM "old_user" ou
	WHERE nullif(btrim(ou."oidc_issuer_id"), '') IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM "account" a
			WHERE a."id" = md5(${legacyOidcAccountIdPrefix} || ou.id)
				AND a."user_id" = ou.id
				AND a."account_id" = btrim(ou."oidc_issuer_id")
				AND a."provider_id" = 'oidc'
				AND a."password" IS NULL
		);
	IF missing_oidc_stub_user_ids IS NOT NULL THEN
		RAISE EXCEPTION 'Legacy OIDC users are missing matching Better Auth account stubs: %',
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
		RAISE EXCEPTION 'Legacy OIDC users unexpectedly received extra Better Auth account rows: %',
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
		RAISE EXCEPTION 'Legacy password users unexpectedly received Better Auth account rows: %',
			password_user_account_ids;
	END IF;

	RAISE NOTICE 'old_user auth-state migration finished (% seconds elapsed)',
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
