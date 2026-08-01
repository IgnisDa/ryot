import { buildReportSql, quoteSqlString } from "./shared";

const featurePreference = (path: string) =>
	`COALESCE((legacy_user."preferences" #>> '{features_enabled,${path}}')::boolean, true)`;

const mediaSpecificPreference = (mediaLot: string) =>
	`COALESCE((legacy_user."preferences" #> '{features_enabled,media,specific}') ? ${quoteSqlString(mediaLot)}, true)`;

const mediaEnabled = featurePreference("media,enabled");

const mediaViewDisabledExpression = (mediaLot: string) =>
	`NOT (${mediaEnabled} AND ${mediaSpecificPreference(mediaLot)})`;

const mediaViewMappings = [
	{ entitySchemaSlug: "book", mediaLot: "book" },
	{ entitySchemaSlug: "show", mediaLot: "show" },
	{ entitySchemaSlug: "movie", mediaLot: "movie" },
	{ entitySchemaSlug: "anime", mediaLot: "anime" },
	{ entitySchemaSlug: "manga", mediaLot: "manga" },
	{ entitySchemaSlug: "music", mediaLot: "music" },
	{ entitySchemaSlug: "podcast", mediaLot: "podcast" },
	{ entitySchemaSlug: "audiobook", mediaLot: "audio_book" },
	{ entitySchemaSlug: "video-game", mediaLot: "video_game" },
	{ entitySchemaSlug: "comic-book", mediaLot: "comic_book" },
	{ entitySchemaSlug: "visual-novel", mediaLot: "visual_novel" },
] as const;

const mediaViewCases = mediaViewMappings
	.map(
		({ entitySchemaSlug, mediaLot }) =>
			`\t\t\tWHEN saved_view."plugin_installation_id" = installations.media_installation_id AND saved_view."entity_schema_slug" = ${quoteSqlString(entitySchemaSlug)} THEN ${mediaViewDisabledExpression(mediaLot)}`,
	)
	.join("\n");

export const buildLegacySavedViewStateMigrationSql = (
	installations: ReadonlyArray<{
		fitnessInstallationId: string;
		mediaInstallationId: string;
		userId: string;
	}>,
	collectionsSavedViewSlug: string,
) => `
DO $$
DECLARE
	rows_updated int;
	started_at timestamptz := clock_timestamp();
BEGIN
	WITH installations (user_id, media_installation_id, fitness_installation_id) AS (
		VALUES ${installations
			.map(
				(row) =>
					`(${quoteSqlString(row.userId)}, ${quoteSqlString(row.mediaInstallationId)}, ${quoteSqlString(row.fitnessInstallationId)})`,
			)
			.join(", ")}
	)
	UPDATE "saved_view" saved_view
	SET "is_disabled" = CASE
		WHEN saved_view."plugin_installation_id" IS NULL AND saved_view."slug" = ${quoteSqlString(collectionsSavedViewSlug)} THEN NOT ${featurePreference("others,collections")}
		WHEN saved_view."plugin_installation_id" = installations.media_installation_id AND saved_view."entity_schema_slug" IN ('person', 'company') THEN NOT (${mediaEnabled} AND ${featurePreference("media,people")})
		WHEN saved_view."plugin_installation_id" = installations.media_installation_id AND saved_view."entity_schema_slug" LIKE '%-group' THEN NOT (${mediaEnabled} AND ${featurePreference("media,groups")})
${mediaViewCases}
		WHEN saved_view."plugin_installation_id" = installations.fitness_installation_id AND saved_view."entity_schema_slug" = 'exercise' THEN NOT ${featurePreference("fitness,enabled")}
		WHEN saved_view."plugin_installation_id" = installations.fitness_installation_id AND saved_view."entity_schema_slug" = 'workout' THEN NOT (${featurePreference("fitness,enabled")} AND ${featurePreference("fitness,workouts")})
		WHEN saved_view."plugin_installation_id" = installations.fitness_installation_id AND saved_view."entity_schema_slug" = 'workout-template' THEN NOT (${featurePreference("fitness,enabled")} AND ${featurePreference("fitness,templates")})
		WHEN saved_view."plugin_installation_id" = installations.fitness_installation_id AND saved_view."entity_schema_slug" = 'measurement' THEN NOT (${featurePreference("fitness,enabled")} AND ${featurePreference("fitness,measurements")})
		ELSE saved_view."is_disabled"
	END
	FROM "old_user" legacy_user
	INNER JOIN installations ON installations.user_id = legacy_user.id
	WHERE saved_view."user_id" = legacy_user."id"
		AND saved_view."is_builtin" = true;
	GET DIAGNOSTICS rows_updated = ROW_COUNT;
	${buildReportSql("legacy saved-view state", [{ message: "built-in saved view state(s) migrated", count: "rows_updated" }])}
END $$;
`;
