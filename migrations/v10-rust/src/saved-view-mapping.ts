import { buildReportSql, quoteSqlString } from "./shared";

const featurePreference = (path: string) =>
	`COALESCE((legacy_user."preferences" #>> '{features_enabled,${path}}')::boolean, true)`;

const mediaSpecificPreference = (mediaLot: string) =>
	`COALESCE((legacy_user."preferences" #> '{features_enabled,media,specific}') ? ${quoteSqlString(mediaLot)}, true)`;

const mediaEnabled = featurePreference("media,enabled");

const mediaViewDisabledExpression = (mediaLot: string) =>
	`NOT (${mediaEnabled} AND ${mediaSpecificPreference(mediaLot)})`;

const mediaViewMappings = [
	{ mediaLot: "book", savedViewSlug: "all-books" },
	{ mediaLot: "show", savedViewSlug: "all-shows" },
	{ mediaLot: "movie", savedViewSlug: "all-movies" },
	{ mediaLot: "anime", savedViewSlug: "all-anime" },
	{ mediaLot: "manga", savedViewSlug: "all-manga" },
	{ mediaLot: "music", savedViewSlug: "all-music" },
	{ mediaLot: "podcast", savedViewSlug: "all-podcasts" },
	{ mediaLot: "audio_book", savedViewSlug: "all-audiobooks" },
	{ mediaLot: "video_game", savedViewSlug: "all-video-games" },
	{ mediaLot: "comic_book", savedViewSlug: "all-comic-books" },
	{ mediaLot: "visual_novel", savedViewSlug: "all-visual-novels" },
] as const;

const mediaGroupSavedViewSlugs = [
	"all-book-series",
	"all-movie-series",
	"all-music-albums",
	"all-audiobook-series",
	"all-comic-book-series",
	"all-video-game-franchises",
] as const;

export const legacySavedViewTargets = {
	kernel: ["collections"],
	fitness: ["all-exercises", "all-workouts", "all-workout-templates", "all-measurements"],
	media: [
		"all-persons",
		"all-companies",
		...mediaViewMappings.map(({ savedViewSlug }) => savedViewSlug),
		...mediaGroupSavedViewSlugs,
	],
} as const;

const mediaViewCases = mediaViewMappings
	.map(
		({ mediaLot, savedViewSlug }) =>
			`\t\t\tWHEN saved_view."plugin_installation_id" = installations.media_installation_id AND saved_view."slug" = ${quoteSqlString(savedViewSlug)} THEN ${mediaViewDisabledExpression(mediaLot)}`,
	)
	.join("\n");

export const buildLegacySavedViewStateMigrationSql = (
	installations: ReadonlyArray<{
		fitnessInstallationId: string;
		mediaInstallationId: string;
		userId: string;
	}>,
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
		WHEN saved_view."plugin_installation_id" IS NULL AND saved_view."slug" = 'collections' THEN NOT ${featurePreference("others,collections")}
		WHEN saved_view."plugin_installation_id" = installations.media_installation_id AND saved_view."slug" IN ('all-persons', 'all-companies') THEN NOT (${mediaEnabled} AND ${featurePreference("media,people")})
		WHEN saved_view."plugin_installation_id" = installations.media_installation_id AND saved_view."slug" IN (${mediaGroupSavedViewSlugs.map(quoteSqlString).join(", ")}) THEN NOT (${mediaEnabled} AND ${featurePreference("media,groups")})
${mediaViewCases}
		WHEN saved_view."plugin_installation_id" = installations.fitness_installation_id AND saved_view."slug" = 'all-exercises' THEN NOT ${featurePreference("fitness,enabled")}
		WHEN saved_view."plugin_installation_id" = installations.fitness_installation_id AND saved_view."slug" = 'all-workouts' THEN NOT (${featurePreference("fitness,enabled")} AND ${featurePreference("fitness,workouts")})
		WHEN saved_view."plugin_installation_id" = installations.fitness_installation_id AND saved_view."slug" = 'all-workout-templates' THEN NOT (${featurePreference("fitness,enabled")} AND ${featurePreference("fitness,templates")})
		WHEN saved_view."plugin_installation_id" = installations.fitness_installation_id AND saved_view."slug" = 'all-measurements' THEN NOT (${featurePreference("fitness,enabled")} AND ${featurePreference("fitness,measurements")})
		ELSE saved_view."is_disabled"
	END
	FROM "old_user" legacy_user
	INNER JOIN installations ON installations.user_id = legacy_user.id
	WHERE saved_view."user_id" = legacy_user."id"
		AND saved_view."is_builtin" = true;
	GET DIAGNOSTICS rows_updated = ROW_COUNT;
	${buildReportSql("legacy saved-view state", [{ count: "rows_updated", message: "built-in saved view state(s) migrated" }])}
END $$;
`;
