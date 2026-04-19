export const buildIntegrationMigrationSql = () => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
	unknown_providers text;
	invalid_required_field_ids text;
BEGIN
	IF to_regclass('"old_integration"') IS NULL THEN
		RAISE EXCEPTION 'Expected old_integration table to exist (created by renameLegacyTables) but it was not found';
	END IF;

	SELECT string_agg(DISTINCT provider, ', ' ORDER BY provider)
	INTO unknown_providers
	FROM "old_integration"
	WHERE provider NOT IN (
		'audiobookshelf', 'komga', 'plex_yank', 'youtube_music',
		'kodi', 'emby', 'plex_sink', 'jellyfin_sink', 'generic_json', 'ryot_browser_extension',
		'radarr', 'sonarr', 'jellyfin_push'
	);
	IF unknown_providers IS NOT NULL THEN
		RAISE EXCEPTION 'Legacy integrations with unknown providers cannot be migrated: %', unknown_providers;
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
		RAISE EXCEPTION 'Legacy integrations with missing required provider-specific fields: %', invalid_required_field_ids;
	END IF;

	RAISE NOTICE 'old_integration -> integration: migration started (% seconds elapsed)', 0.0;

	INSERT INTO "integration" (
		"id",
		"user_id",
		"lot",
		"provider",
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
		oi.name,
		COALESCE(oi.is_disabled, false),
		COALESCE(oi.minimum_progress, 2),
		COALESCE(oi.maximum_progress, 95),
		COALESCE(oi.sync_to_owned_collection, false),
		jsonb_build_object(
			'disableOnContinuousErrors',
			COALESCE((oi.extra_settings->>'disable_on_continuous_errors')::boolean, false)
		),
		CASE oi.provider
			WHEN 'audiobookshelf' THEN jsonb_build_object(
				'kind', 'audiobookshelf',
				'baseUrl', oi.provider_specifics->>'audiobookshelf_base_url',
				'token', oi.provider_specifics->>'audiobookshelf_token'
			)
			WHEN 'komga' THEN jsonb_build_object(
				'kind', 'komga',
				'baseUrl', oi.provider_specifics->>'komga_base_url',
				'apiKey', oi.provider_specifics->>'komga_api_key'
			)
			WHEN 'plex_yank' THEN jsonb_build_object(
				'kind', 'plex_yank',
				'baseUrl', oi.provider_specifics->>'plex_yank_base_url',
				'token', oi.provider_specifics->>'plex_yank_token'
			)
			WHEN 'youtube_music' THEN jsonb_build_object(
				'kind', 'youtube_music',
				'timezone', oi.provider_specifics->>'youtube_music_timezone',
				'authCookie', oi.provider_specifics->>'youtube_music_auth_cookie'
			)
			WHEN 'kodi' THEN jsonb_build_object('kind', 'kodi')
			WHEN 'emby' THEN jsonb_build_object('kind', 'emby')
			WHEN 'generic_json' THEN jsonb_build_object('kind', 'generic_json')
			WHEN 'plex_sink' THEN jsonb_build_object('kind', 'plex_sink')
				|| (CASE WHEN oi.provider_specifics->>'plex_sink_username' IS NOT NULL
					THEN jsonb_build_object('username', oi.provider_specifics->>'plex_sink_username')
					ELSE '{}'::jsonb END)
			WHEN 'jellyfin_sink' THEN jsonb_build_object('kind', 'jellyfin_sink')
				|| (CASE WHEN oi.provider_specifics->>'jellyfin_sink_username' IS NOT NULL
					THEN jsonb_build_object('username', oi.provider_specifics->>'jellyfin_sink_username')
					ELSE '{}'::jsonb END)
				|| (CASE WHEN oi.provider_specifics->>'jellyfin_sink_metadata_provider' IS NOT NULL
					THEN jsonb_build_object('metadataProvider', lower(oi.provider_specifics->>'jellyfin_sink_metadata_provider'))
					ELSE '{}'::jsonb END)
			WHEN 'ryot_browser_extension' THEN jsonb_build_object('kind', 'ryot_browser_extension')
				|| (CASE WHEN jsonb_typeof(oi.provider_specifics->'ryot_browser_extension_disabled_sites') = 'array'
					THEN jsonb_build_object('disabledSites', oi.provider_specifics->'ryot_browser_extension_disabled_sites')
					ELSE '{}'::jsonb END)
			WHEN 'radarr' THEN jsonb_build_object(
				'kind', 'radarr',
				'baseUrl', oi.provider_specifics->>'radarr_base_url',
				'apiKey', oi.provider_specifics->>'radarr_api_key',
				'profileId', oi.provider_specifics->>'radarr_profile_id',
				'rootFolderPath', oi.provider_specifics->>'radarr_root_folder_path',
				'syncCollectionIds', oi.provider_specifics->'radarr_sync_collection_ids'
			)
				|| (CASE WHEN jsonb_typeof(oi.provider_specifics->'radarr_tag_ids') = 'array'
					THEN jsonb_build_object('tagIds', oi.provider_specifics->'radarr_tag_ids')
					ELSE '{}'::jsonb END)
			WHEN 'sonarr' THEN jsonb_build_object(
				'kind', 'sonarr',
				'baseUrl', oi.provider_specifics->>'sonarr_base_url',
				'apiKey', oi.provider_specifics->>'sonarr_api_key',
				'profileId', oi.provider_specifics->>'sonarr_profile_id',
				'rootFolderPath', oi.provider_specifics->>'sonarr_root_folder_path',
				'syncCollectionIds', oi.provider_specifics->'sonarr_sync_collection_ids'
			)
				|| (CASE WHEN jsonb_typeof(oi.provider_specifics->'sonarr_tag_ids') = 'number'
					THEN jsonb_build_object('tagIds', oi.provider_specifics->'sonarr_tag_ids')
					ELSE '{}'::jsonb END)
			WHEN 'jellyfin_push' THEN jsonb_build_object(
				'kind', 'jellyfin_push',
				'baseUrl', oi.provider_specifics->>'jellyfin_push_base_url',
				'username', oi.provider_specifics->>'jellyfin_push_username'
			)
				|| (CASE WHEN oi.provider_specifics->>'jellyfin_push_password' IS NOT NULL
					THEN jsonb_build_object('password', oi.provider_specifics->>'jellyfin_push_password')
					ELSE '{}'::jsonb END)
		END,
		oi.created_on,
		oi.last_finished_at,
		oi.created_on
	FROM "old_integration" oi
	ON CONFLICT ("id") DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE 'old_integration -> integration: % row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
