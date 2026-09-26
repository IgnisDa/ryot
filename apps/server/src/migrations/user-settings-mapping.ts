import { buildReportSql, quoteSqlString } from "./shared";

export const buildLegacyUserSettingsMigrationSql = (
	installations: ReadonlyArray<{ userId: string; installationId: string }>,
	mediaPluginId: string,
) => {
	const values = installations
		.map(
			({ userId, installationId }) =>
				`(${quoteSqlString(userId)}, ${quoteSqlString(installationId)})`,
		)
		.join(", ");
	return `DO $$
	DECLARE
		rows_updated bigint;
		started_at timestamptz := clock_timestamp();
	BEGIN
		IF EXISTS (SELECT 1 FROM "migration_report" WHERE phase = 'old_user -> plugin user settings') THEN
			RETURN;
		END IF;
		WITH installations (user_id, installation_id) AS (VALUES ${values})
		UPDATE "plugin_installation" installation
		SET "user_settings" = jsonb_build_object(
			'allowNsfw', COALESCE((legacy_user.preferences #>> '{general,display_nsfw}')::boolean, true)
		)
		FROM installations target
		JOIN "old_user" legacy_user ON legacy_user.id = target.user_id
		WHERE installation.id = target.installation_id
			AND installation.user_id = target.user_id
			AND installation.plugin_id = ${quoteSqlString(mediaPluginId)};
		GET DIAGNOSTICS rows_updated = ROW_COUNT;
		IF rows_updated <> ${installations.length} THEN
			RAISE EXCEPTION 'Legacy bootstrap: expected ${installations.length} exact Media installations for user settings, found %. NSFW preferences cannot be attributed safely. Keep the dump and report this migration defect.', rows_updated;
		END IF;
		${buildReportSql("old_user -> plugin user settings", [{ count: "rows_updated", message: "user preference record(s) migrated" }])}
	END $$;`;
};
