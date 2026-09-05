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

const disabledExpressionBySlug = new Map<string, string>([
	["collections", `NOT ${featurePreference("others,collections")}`],
	["all-persons", `NOT (${mediaEnabled} AND ${featurePreference("media,people")})`],
	["all-companies", `NOT (${mediaEnabled} AND ${featurePreference("media,people")})`],
	...mediaGroupSavedViewSlugs.map(
		(slug) => [slug, `NOT (${mediaEnabled} AND ${featurePreference("media,groups")})`] as const,
	),
	...mediaViewMappings.map(
		({ mediaLot, savedViewSlug }) =>
			[savedViewSlug, mediaViewDisabledExpression(mediaLot)] as const,
	),
	["all-exercises", `NOT ${featurePreference("fitness,enabled")}`],
	[
		"all-workouts",
		`NOT (${featurePreference("fitness,enabled")} AND ${featurePreference("fitness,workouts")})`,
	],
	[
		"all-workout-templates",
		`NOT (${featurePreference("fitness,enabled")} AND ${featurePreference("fitness,templates")})`,
	],
	[
		"all-measurements",
		`NOT (${featurePreference("fitness,enabled")} AND ${featurePreference("fitness,measurements")})`,
	],
]);

export const buildLegacySavedViewStateMigrationSql = (
	installations: ReadonlyArray<{
		fitnessInstallationId: string;
		mediaInstallationId: string;
		userId: string;
	}>,
	plugins: { fitnessPluginId: string; mediaPluginId: string },
) => {
	const slugPluginPairs = [
		...legacySavedViewTargets.kernel.map((slug) => `(${quoteSqlString(slug)}, NULL::text)`),
		...legacySavedViewTargets.media.map(
			(slug) => `(${quoteSqlString(slug)}, ${quoteSqlString(plugins.mediaPluginId)}::text)`,
		),
		...legacySavedViewTargets.fitness.map(
			(slug) => `(${quoteSqlString(slug)}, ${quoteSqlString(plugins.fitnessPluginId)}::text)`,
		),
	].join(", ");
	const disabledCases = [...disabledExpressionBySlug.entries()]
		.map(([slug, expression]) => `\t\t\tWHEN ${quoteSqlString(slug)} THEN ${expression}`)
		.join("\n");
	const installationsValues = installations
		.map(
			(row) =>
				`(${quoteSqlString(row.userId)}, ${quoteSqlString(row.mediaInstallationId)}, ${quoteSqlString(row.fitnessInstallationId)})`,
		)
		.join(", ");
	const desiredCtes = `installations (user_id, media_installation_id, fitness_installation_id) AS (
		VALUES ${installationsValues}
	),
	desired_slug (slug, plugin_id) AS (
		VALUES ${slugPluginPairs}
	),
	desired AS (
		SELECT legacy_user.id AS user_id, desired_slug.slug, desired_slug.plugin_id,
			CASE desired_slug.slug
${disabledCases}
				ELSE false
			END AS is_disabled
		FROM "old_user" legacy_user
		INNER JOIN installations ON installations.user_id = legacy_user.id
		CROSS JOIN desired_slug
	)`;
	return `
DO $$
DECLARE
	rows_inserted int;
	missing_count int;
	missing_sample text;
	started_at timestamptz := clock_timestamp();
BEGIN
	WITH ${desiredCtes},
	disabled AS (
		SELECT desired.user_id, desired.slug, desired.plugin_id, effective."sort_order"
		FROM desired
		INNER JOIN "user_saved_view" effective
			ON effective."user_id" = desired.user_id
			AND effective."slug" = desired.slug
			AND effective."plugin_id" IS NOT DISTINCT FROM desired.plugin_id
		WHERE desired.is_disabled
	)
	INSERT INTO "saved_view_override" ("user_id", "slug", "plugin_id", "sort_order", "is_disabled")
	SELECT user_id, slug, plugin_id, sort_order, true
	FROM disabled
	ON CONFLICT ("user_id", "slug") DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	WITH ${desiredCtes}
	SELECT count(*) INTO missing_count
	FROM desired
	LEFT JOIN "user_saved_view" effective
		ON effective."user_id" = desired.user_id
		AND effective."slug" = desired.slug
		AND effective."plugin_id" IS NOT DISTINCT FROM desired.plugin_id
	WHERE effective."user_id" IS NULL;
	IF missing_count > 0 THEN
		WITH ${desiredCtes}
		SELECT string_agg(sample.label, '; ' ORDER BY sample.label)
		INTO missing_sample
		FROM (
			SELECT (desired.user_id || '/' || desired.slug) AS label
			FROM desired
			LEFT JOIN "user_saved_view" effective
				ON effective."user_id" = desired.user_id
				AND effective."slug" = desired.slug
				AND effective."plugin_id" IS NOT DISTINCT FROM desired.plugin_id
			WHERE effective."user_id" IS NULL
			ORDER BY desired.user_id, desired.slug LIMIT 20
		) sample;
		RAISE EXCEPTION 'legacy saved-view state: % expected built-in saved view(s) have no effective definition, so their disabled state cannot be migrated (sample: %). Use a build whose saved-view set covers these slugs, then start the server again.', missing_count, missing_sample;
	END IF;

	${buildReportSql("legacy saved-view state", [{ count: "rows_inserted", message: "built-in saved view override(s) migrated" }])}
END $$;
`;
};
