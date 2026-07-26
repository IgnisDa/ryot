import { Effect, Schema } from "effect";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";

import { buildRequireLegacyTableSql, buildReportSql, quoteSqlString } from "./shared";

const legacyProviderSpecificsSql = (alias: string) => `CASE ${alias}.provider
	WHEN 'audiobookshelf' THEN jsonb_build_object('kind', 'audiobookshelf', 'baseUrl', ${alias}.provider_specifics->>'audiobookshelf_base_url', 'token', ${alias}.provider_specifics->>'audiobookshelf_token')
	WHEN 'komga' THEN jsonb_build_object('kind', 'komga', 'baseUrl', ${alias}.provider_specifics->>'komga_base_url', 'apiKey', ${alias}.provider_specifics->>'komga_api_key')
	WHEN 'plex_yank' THEN jsonb_build_object('kind', 'plex_yank', 'baseUrl', ${alias}.provider_specifics->>'plex_yank_base_url', 'token', ${alias}.provider_specifics->>'plex_yank_token')
	WHEN 'youtube_music' THEN jsonb_build_object('kind', 'youtube_music', 'timezone', ${alias}.provider_specifics->>'youtube_music_timezone', 'authCookie', ${alias}.provider_specifics->>'youtube_music_auth_cookie')
	WHEN 'kodi' THEN jsonb_build_object('kind', 'kodi')
	WHEN 'emby' THEN jsonb_build_object('kind', 'emby')
	WHEN 'plex_sink' THEN jsonb_build_object('kind', 'plex_sink') || (CASE WHEN ${alias}.provider_specifics->>'plex_sink_username' IS NOT NULL THEN jsonb_build_object('username', ${alias}.provider_specifics->>'plex_sink_username') ELSE '{}'::jsonb END)
	WHEN 'jellyfin_sink' THEN jsonb_build_object('kind', 'jellyfin_sink') || (CASE WHEN ${alias}.provider_specifics->>'jellyfin_sink_username' IS NOT NULL THEN jsonb_build_object('username', ${alias}.provider_specifics->>'jellyfin_sink_username') ELSE '{}'::jsonb END) || (CASE WHEN ${alias}.provider_specifics->>'jellyfin_sink_metadata_provider' IS NOT NULL THEN jsonb_build_object('metadataProvider', lower(${alias}.provider_specifics->>'jellyfin_sink_metadata_provider')) ELSE '{}'::jsonb END)
	WHEN 'ryot_browser_extension' THEN jsonb_build_object('kind', 'ryot_browser_extension') || (CASE WHEN jsonb_typeof(${alias}.provider_specifics->'ryot_browser_extension_disabled_sites') = 'array' THEN jsonb_build_object('disabledSites', ${alias}.provider_specifics->'ryot_browser_extension_disabled_sites') ELSE '{}'::jsonb END)
	WHEN 'radarr' THEN jsonb_build_object('kind', 'radarr', 'baseUrl', ${alias}.provider_specifics->>'radarr_base_url', 'apiKey', ${alias}.provider_specifics->>'radarr_api_key', 'profileId', ${alias}.provider_specifics->>'radarr_profile_id', 'rootFolderPath', ${alias}.provider_specifics->>'radarr_root_folder_path', 'syncCollectionIds', ${alias}.provider_specifics->'radarr_sync_collection_ids') || (CASE WHEN jsonb_typeof(${alias}.provider_specifics->'radarr_tag_ids') = 'array' THEN jsonb_build_object('tagIds', ${alias}.provider_specifics->'radarr_tag_ids') ELSE '{}'::jsonb END)
	WHEN 'sonarr' THEN jsonb_build_object('kind', 'sonarr', 'baseUrl', ${alias}.provider_specifics->>'sonarr_base_url', 'apiKey', ${alias}.provider_specifics->>'sonarr_api_key', 'profileId', ${alias}.provider_specifics->>'sonarr_profile_id', 'rootFolderPath', ${alias}.provider_specifics->>'sonarr_root_folder_path', 'syncCollectionIds', ${alias}.provider_specifics->'sonarr_sync_collection_ids') || (CASE WHEN jsonb_typeof(${alias}.provider_specifics->'sonarr_tag_ids') = 'number' THEN jsonb_build_object('tagIds', jsonb_build_array(${alias}.provider_specifics->'sonarr_tag_ids')) ELSE '{}'::jsonb END)
	WHEN 'jellyfin_push' THEN jsonb_build_object('kind', 'jellyfin_push', 'baseUrl', ${alias}.provider_specifics->>'jellyfin_push_base_url', 'username', ${alias}.provider_specifics->>'jellyfin_push_username') || (CASE WHEN ${alias}.provider_specifics->>'jellyfin_push_password' IS NOT NULL THEN jsonb_build_object('password', ${alias}.provider_specifics->>'jellyfin_push_password') ELSE '{}'::jsonb END)
END`;

const LegacyIntegrationSettings = Schema.Struct({
	id: Schema.String,
	lot: Schema.String,
	userId: Schema.String,
	provider: Schema.String,
	settings: Schema.Record(Schema.String, Schema.Unknown),
});

export const readLegacyIntegrationSettings = Effect.fn("readLegacyIntegrationSettings")(function* (
	connection: SqlConnection.Connection,
) {
	const rows = yield* connection.execute(
		`SELECT oi.id, oi.lot, oi.user_id AS "userId", oi.provider, ${legacyProviderSpecificsSql("oi")} AS settings FROM "old_integration" oi WHERE oi.provider <> 'generic_json' ORDER BY oi.id`,
		[],
		undefined,
	);
	return yield* Effect.orDie(
		Schema.decodeUnknownEffect(Schema.Array(LegacyIntegrationSettings))(rows),
	);
});

export const buildIntegrationMigrationSql = (input: {
	installations: ReadonlyArray<{ installationId: string; userId: string }>;
	providerSlugs: ReadonlyArray<string>;
}) => {
	const installationValuesSql =
		input.installations
			.map((row) => `(${quoteSqlString(row.userId)}, ${quoteSqlString(row.installationId)})`)
			.join(", ") || "(NULL::text, NULL::text)";
	return `
DO $$
DECLARE
	generic_json_rows int;
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
	unknown_providers text;
	conflicting_integration_ids text;
	invalid_required_field_ids text;
	unresolved_installation_ids text;
BEGIN
	${buildRequireLegacyTableSql("old_integration -> integration", "old_integration")}

	SELECT string_agg(DISTINCT provider, ', ' ORDER BY provider)
	INTO unknown_providers
	FROM "old_integration"
	WHERE provider NOT IN (${[...input.providerSlugs, "generic_json"].map(quoteSqlString).join(", ")});
	IF unknown_providers IS NOT NULL THEN
		RAISE EXCEPTION 'old_integration -> integration: these legacy integration providers do not exist in this build''s media plugin, so the integrations using them would silently stop working: %. Delete those integrations in the V1 database, or use a build whose media plugin provides them, then start the server again.', unknown_providers;
	END IF;

	SELECT string_agg(id, ', ' ORDER BY id)
	INTO invalid_required_field_ids
	FROM "old_integration"
	WHERE
		(provider = 'audiobookshelf' AND (
			provider_specifics->>'audiobookshelf_base_url' IS NULL
			OR provider_specifics->>'audiobookshelf_token' IS NULL))
		OR (provider = 'komga' AND (
			provider_specifics->>'komga_base_url' IS NULL
			OR provider_specifics->>'komga_api_key' IS NULL))
		OR (provider = 'plex_yank' AND (
			provider_specifics->>'plex_yank_base_url' IS NULL
			OR provider_specifics->>'plex_yank_token' IS NULL))
		OR (provider = 'youtube_music' AND (
			provider_specifics->>'youtube_music_timezone' IS NULL
			OR provider_specifics->>'youtube_music_auth_cookie' IS NULL))
		OR (provider = 'radarr' AND (
			provider_specifics->>'radarr_base_url' IS NULL
			OR provider_specifics->>'radarr_api_key' IS NULL
			OR provider_specifics->>'radarr_profile_id' IS NULL
			OR provider_specifics->>'radarr_root_folder_path' IS NULL
			OR provider_specifics->'radarr_sync_collection_ids' IS NULL))
		OR (provider = 'sonarr' AND (
			provider_specifics->>'sonarr_base_url' IS NULL
			OR provider_specifics->>'sonarr_api_key' IS NULL
			OR provider_specifics->>'sonarr_profile_id' IS NULL
			OR provider_specifics->>'sonarr_root_folder_path' IS NULL
			OR provider_specifics->'sonarr_sync_collection_ids' IS NULL))
		OR (provider = 'jellyfin_push' AND (
			provider_specifics->>'jellyfin_push_base_url' IS NULL
			OR provider_specifics->>'jellyfin_push_username' IS NULL));
	IF invalid_required_field_ids IS NOT NULL THEN
		RAISE EXCEPTION 'old_integration -> integration: these legacy integrations are missing settings that this build''s provider requires, so they cannot be migrated as working integrations: %. Fill in the missing settings in the V1 database, or delete those integrations, then start the server again.', invalid_required_field_ids;
	END IF;

	SELECT string_agg(oi.id, ', ' ORDER BY oi.id)
	INTO unresolved_installation_ids
	FROM "old_integration" oi
	WHERE oi.provider <> 'generic_json'
		AND NOT EXISTS (
			SELECT 1
			FROM (VALUES ${installationValuesSql}) installations(user_id, installation_id)
			WHERE installations.user_id = oi.user_id
		);
	IF unresolved_installation_ids IS NOT NULL THEN
		RAISE EXCEPTION 'old_integration -> integration: these legacy integrations belong to a user with no ready media plugin installation, so there is nothing in V2 to attach them to: %. Installations are created earlier in this same run, so this is a defect in this migration rather than in the legacy data. Keep the dump and report it; retrying will not change the result.', unresolved_installation_ids;
	END IF;

	SELECT string_agg(oi.id, ', ' ORDER BY oi.id)
	INTO conflicting_integration_ids
	FROM "old_integration" oi
	INNER JOIN "integration" existing ON existing.id = oi.id
	INNER JOIN (VALUES ${installationValuesSql}) installations(user_id, installation_id)
		ON installations.user_id = oi.user_id
	WHERE oi.provider <> 'generic_json'
		AND (
			existing.user_id IS DISTINCT FROM oi.user_id
			OR existing.lot IS DISTINCT FROM oi.lot
			OR existing.provider IS DISTINCT FROM oi.provider
			OR existing.plugin_installation_id IS DISTINCT FROM installations.installation_id
		);
	IF conflicting_integration_ids IS NOT NULL THEN
		RAISE EXCEPTION 'old_integration -> integration: existing V2 rows reuse these legacy integration IDs with different user, provider, lot, or installation identity: %. This database was partly migrated by a different build; restore the V1 dump and start again.', conflicting_integration_ids;
	END IF;

	INSERT INTO "integration" (
		"id",
		"user_id",
		"lot",
		"provider",
		"plugin_installation_id",
		"name",
		"is_disabled",
		"minimum_progress",
		"maximum_progress",
		"sync_ownership",
		"extra_settings",
		"provider_specifics",
		"created_at",
		"last_finished_at",
		"updated_at"
	)
	SELECT
		oi.id,
		oi.user_id,
		oi.lot,
		oi.provider,
		installations.installation_id,
		oi.name,
		COALESCE(oi.is_disabled, false),
		COALESCE(oi.minimum_progress, 2),
		COALESCE(oi.maximum_progress, 95),
		COALESCE(oi.sync_to_owned_collection, false),
		jsonb_build_object(
			'disableOnContinuousErrors',
			COALESCE((oi.extra_settings->>'disable_on_continuous_errors')::boolean, false)
		),
		${legacyProviderSpecificsSql("oi")},
		oi.created_on,
		oi.last_finished_at,
		oi.created_on
	FROM "old_integration" oi
	INNER JOIN (VALUES ${installationValuesSql}) installations(user_id, installation_id)
		ON installations.user_id = oi.user_id
	WHERE oi.provider <> 'generic_json'
	ON CONFLICT ("id") DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	SELECT count(*)
	INTO generic_json_rows
	FROM "old_integration"
	WHERE provider = 'generic_json';
	${buildReportSql("old_integration -> integration", [{ count: "rows_inserted", message: "row(s) migrated" }])}
	${buildReportSql("old_integration -> integration", [{ count: "generic_json_rows", message: "generic_json integration row(s) skipped because the provider was removed in V2" }])}
END $$;
`;
};
