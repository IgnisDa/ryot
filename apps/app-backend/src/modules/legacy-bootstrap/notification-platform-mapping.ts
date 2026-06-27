export const buildNotificationPlatformMigrationSql = () => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
	unknown_platforms text;
	invalid_platform_ids text;
	invalid_event_values text;
BEGIN
	IF to_regclass('"old_notification_platform"') IS NULL THEN
		RAISE EXCEPTION 'Expected old_notification_platform table to exist (created by renameLegacyTables) but it was not found';
	END IF;

	SELECT string_agg(DISTINCT lot, ', ' ORDER BY lot)
	INTO unknown_platforms
	FROM "old_notification_platform"
	WHERE lot NOT IN (
		'apprise', 'discord', 'email', 'gotify', 'ntfy',
		'push_bullet', 'push_over', 'push_safer', 'telegram'
	);
	IF unknown_platforms IS NOT NULL THEN
		RAISE EXCEPTION 'Legacy notification platforms with unknown lots cannot be migrated: %', unknown_platforms;
	END IF;

	SELECT string_agg(id, ', ' ORDER BY id)
	INTO invalid_platform_ids
	FROM "old_notification_platform"
	WHERE
		platform_specifics IS NULL
		OR jsonb_typeof(platform_specifics) <> 'object'
		OR jsonb_typeof(platform_specifics->'d') <> 'object'
		OR (lot = 'apprise' AND (platform_specifics->>'t' IS DISTINCT FROM 'Apprise'
			OR nullif(btrim(platform_specifics->'d'->>'url'), '') IS NULL
			OR nullif(btrim(platform_specifics->'d'->>'key'), '') IS NULL))
		OR (lot = 'discord' AND (platform_specifics->>'t' IS DISTINCT FROM 'Discord'
			OR nullif(btrim(platform_specifics->'d'->>'url'), '') IS NULL))
		OR (lot = 'email' AND (platform_specifics->>'t' IS DISTINCT FROM 'Email'
			OR nullif(btrim(platform_specifics->'d'->>'email'), '') IS NULL))
		OR (lot = 'gotify' AND (platform_specifics->>'t' IS DISTINCT FROM 'Gotify'
			OR nullif(btrim(platform_specifics->'d'->>'url'), '') IS NULL
			OR nullif(btrim(platform_specifics->'d'->>'token'), '') IS NULL))
		OR (lot = 'ntfy' AND (platform_specifics->>'t' IS DISTINCT FROM 'Ntfy'
			OR nullif(btrim(platform_specifics->'d'->>'topic'), '') IS NULL))
		OR (lot = 'push_bullet' AND (platform_specifics->>'t' IS DISTINCT FROM 'PushBullet'
			OR nullif(btrim(platform_specifics->'d'->>'api_token'), '') IS NULL))
		OR (lot = 'push_over' AND (platform_specifics->>'t' IS DISTINCT FROM 'PushOver'
			OR nullif(btrim(platform_specifics->'d'->>'key'), '') IS NULL))
		OR (lot = 'push_safer' AND (platform_specifics->>'t' IS DISTINCT FROM 'PushSafer'
			OR nullif(btrim(platform_specifics->'d'->>'key'), '') IS NULL))
		OR (lot = 'telegram' AND (platform_specifics->>'t' IS DISTINCT FROM 'Telegram'
			OR nullif(btrim(platform_specifics->'d'->>'bot_token'), '') IS NULL
			OR nullif(btrim(platform_specifics->'d'->>'chat_id'), '') IS NULL));
	IF invalid_platform_ids IS NOT NULL THEN
		RAISE EXCEPTION 'Legacy notification platforms with invalid specifics: %', invalid_platform_ids;
	END IF;

	SELECT string_agg(id, ', ' ORDER BY id)
	INTO invalid_event_values
	FROM "old_notification_platform" p
	WHERE p.configured_events IS NULL
		OR EXISTS (
			SELECT 1
			FROM unnest(p.configured_events) AS event_name
			WHERE event_name IS NULL OR event_name NOT IN (
				'notification_from_reminder_collection',
				'integration_disabled_due_to_too_many_errors',
				'new_workout_created',
				'metadata_status_changed',
				'person_metadata_associated',
				'metadata_episode_images_changed',
				'person_metadata_group_associated',
				'metadata_number_of_seasons_changed',
				'metadata_episode_released',
				'metadata_chapters_or_episodes_changed',
				'review_posted',
				'metadata_published',
				'outdated_seen_entries',
				'metadata_release_date_changed',
				'metadata_episode_name_changed',
				'metadata_moved_from_completed_to_watchlist_collection'
			)
		);
	IF invalid_event_values IS NOT NULL THEN
		RAISE EXCEPTION 'Legacy notification platforms with invalid configured events: %', invalid_event_values;
	END IF;

	RAISE NOTICE 'old_notification_platform -> notification_platform: migration started (% seconds elapsed)', 0.0;

	INSERT INTO "notification_platform" (
		"id",
		"user_id",
		"platform",
		"platform_specifics",
		"configured_events",
		"is_disabled",
		"created_at",
		"updated_at"
	)
	SELECT
		op.id,
		op.user_id,
		op.lot,
		CASE op.lot
			WHEN 'apprise' THEN jsonb_build_object(
				'kind', 'apprise',
				'baseUrl', op.platform_specifics->'d'->>'url',
				'key', op.platform_specifics->'d'->>'key'
			)
			WHEN 'discord' THEN jsonb_build_object(
				'kind', 'discord',
				'webhookUrl', op.platform_specifics->'d'->>'url'
			)
			WHEN 'email' THEN jsonb_build_object(
				'kind', 'email',
				'recipient', op.platform_specifics->'d'->>'email'
			)
			WHEN 'gotify' THEN jsonb_build_object(
				'kind', 'gotify',
				'baseUrl', op.platform_specifics->'d'->>'url',
				'token', op.platform_specifics->'d'->>'token'
			)
				|| CASE WHEN nullif(btrim(op.platform_specifics->'d'->>'priority'), '') IS NOT NULL
					THEN jsonb_build_object('priority', (op.platform_specifics->'d'->>'priority')::int)
					ELSE '{}'::jsonb END
			WHEN 'ntfy' THEN jsonb_build_object(
				'kind', 'ntfy',
				'topic', op.platform_specifics->'d'->>'topic'
			)
				|| CASE WHEN nullif(btrim(op.platform_specifics->'d'->>'url'), '') IS NOT NULL
					THEN jsonb_build_object('baseUrl', op.platform_specifics->'d'->>'url')
					ELSE '{}'::jsonb END
				|| CASE WHEN nullif(btrim(op.platform_specifics->'d'->>'priority'), '') IS NOT NULL
					THEN jsonb_build_object('priority', (op.platform_specifics->'d'->>'priority')::int)
					ELSE '{}'::jsonb END
				|| CASE WHEN nullif(btrim(op.platform_specifics->'d'->>'auth_header'), '') IS NOT NULL
					THEN jsonb_build_object('accessToken', op.platform_specifics->'d'->>'auth_header')
					ELSE '{}'::jsonb END
			WHEN 'push_bullet' THEN jsonb_build_object(
				'kind', 'push_bullet',
				'accessToken', op.platform_specifics->'d'->>'api_token'
			)
			WHEN 'push_over' THEN jsonb_build_object(
				'kind', 'push_over',
				'userKey', op.platform_specifics->'d'->>'key'
			)
				|| CASE WHEN nullif(btrim(op.platform_specifics->'d'->>'app_key'), '') IS NOT NULL
					THEN jsonb_build_object('appToken', op.platform_specifics->'d'->>'app_key')
					ELSE '{}'::jsonb END
				|| CASE WHEN nullif(btrim(op.platform_specifics->'d'->>'device'), '') IS NOT NULL
					THEN jsonb_build_object('device', op.platform_specifics->'d'->>'device')
					ELSE '{}'::jsonb END
			WHEN 'push_safer' THEN jsonb_build_object(
				'kind', 'push_safer',
				'key', op.platform_specifics->'d'->>'key'
			)
			WHEN 'telegram' THEN jsonb_build_object(
				'kind', 'telegram',
				'botToken', op.platform_specifics->'d'->>'bot_token',
				'chatId', op.platform_specifics->'d'->>'chat_id'
			)
		END,
		op.configured_events,
		COALESCE(op.is_disabled, false),
		op.created_on,
		op.created_on
	FROM "old_notification_platform" op
	ON CONFLICT ("id") DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE 'old_notification_platform -> notification_platform: % row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
