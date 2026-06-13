import { z } from "@hono/zod-openapi";

import { itemDataSchema, listDataSchema } from "~/lib/openapi";
import { createIdParamsSchema, nonEmptyStringSchema } from "~/lib/zod";

export const importRunStatus = z.enum(["pending", "running", "completed", "failed"]);
export type ImportRunStatus = z.infer<typeof importRunStatus>;

export const importRunSource = z.enum([
	"emby",
	"hevy",
	"igdb",
	"imdb",
	"kodi",
	"plex",
	"komga",
	"trakt",
	"movary",
	"radarr",
	"sonarr",
	"anilist",
	"grouvee",
	"netflix",
	"jellyfin",
	"watcharr",
	"goodreads",
	"hardcover",
	"plex_sink",
	"plex_yank",
	"open_scale",
	"storygraph",
	"strong_app",
	"myanimelist",
	"generic_json",
	"media_tracker",
	"jellyfin_push",
	"jellyfin_sink",
	"youtube_music",
	"audiobookshelf",
	"ryot_browser_extension",
]);
export type ImportRunSource = z.infer<typeof importRunSource>;

export const importRunFailureStage = z.enum([
	"source_fetch",
	"database_commit",
	"provider_details",
	"provider_resolution",
	"event_before_trigger",
	"input_transformation",
]);

export type ImportRunFailureStage = z.infer<typeof importRunFailureStage>;

export const fileImportRunSources = [
	"hevy",
	"igdb",
	"imdb",
	"netflix",
	"movary",
	"anilist",
	"grouvee",
	"watcharr",
	"goodreads",
	"hardcover",
	"strong_app",
	"open_scale",
	"storygraph",
	"myanimelist",
] as const;

const sourceApiUrlSchema = z
	.string()
	.trim()
	.superRefine((value, ctx) => {
		try {
			const url = new URL(value);
			if (!["http:", "https:"].includes(url.protocol)) {
				throw new Error();
			}
		} catch {
			ctx.addIssue({
				code: "custom",
				message: "Import source URL must be a valid http or https URL",
			});
		}
	});

const allowInsecureConnectionsField = {
	allowInsecureConnections: z.boolean().optional(),
};

const urlAndKeyRunInput = <Source extends ImportRunSource>(source: Source) =>
	z.object({
		apiUrl: sourceApiUrlSchema,
		apiKey: nonEmptyStringSchema,
		source: z.literal(source),
		...allowInsecureConnectionsField,
	});

const uploadTokenRunInput = <Source extends (typeof fileImportRunSources)[number]>(
	source: Source,
) => z.object({ uploadToken: nonEmptyStringSchema, source: z.literal(source) });

const openScaleRunInput = uploadTokenRunInput("open_scale");
const hevyRunInput = uploadTokenRunInput("hevy");
const strongAppRunInput = uploadTokenRunInput("strong_app");
const goodreadsRunInput = uploadTokenRunInput("goodreads");
const hardcoverRunInput = uploadTokenRunInput("hardcover");
const storygraphRunInput = uploadTokenRunInput("storygraph");
const imdbRunInput = uploadTokenRunInput("imdb");
const netflixRunInput = uploadTokenRunInput("netflix").extend({
	profileName: z.string().trim().optional(),
});
const grouveeRunInput = uploadTokenRunInput("grouvee");
const anilistRunInput = uploadTokenRunInput("anilist");
const watcharrRunInput = uploadTokenRunInput("watcharr");
const movaryRunInput = z.object({
	source: z.literal("movary"),
	historyUploadToken: nonEmptyStringSchema,
	ratingsUploadToken: nonEmptyStringSchema,
	watchlistUploadToken: nonEmptyStringSchema,
});
const igdbRunInput = uploadTokenRunInput("igdb").extend({ collection: nonEmptyStringSchema });
const myanimelistRunInput = z.object({
	source: z.literal("myanimelist"),
	animeUploadToken: nonEmptyStringSchema.optional(),
	mangaUploadToken: nonEmptyStringSchema.optional(),
});
const traktRunInput = z.object({ username: nonEmptyStringSchema, source: z.literal("trakt") });
const plexRunInput = urlAndKeyRunInput("plex");
const mediaTrackerRunInput = urlAndKeyRunInput("media_tracker");
const audiobookshelfRunInput = urlAndKeyRunInput("audiobookshelf");
const jellyfinRunInput = z.object({
	apiUrl: sourceApiUrlSchema,
	username: nonEmptyStringSchema,
	source: z.literal("jellyfin"),
	password: nonEmptyStringSchema.optional(),
	...allowInsecureConnectionsField,
});

export const createImportRunBody = z.discriminatedUnion("source", [
	hevyRunInput,
	igdbRunInput,
	imdbRunInput,
	plexRunInput,
	traktRunInput,
	movaryRunInput,
	anilistRunInput,
	grouveeRunInput,
	netflixRunInput,
	jellyfinRunInput,
	watcharrRunInput,
	openScaleRunInput,
	goodreadsRunInput,
	hardcoverRunInput,
	strongAppRunInput,
	storygraphRunInput,
	myanimelistRunInput,
	mediaTrackerRunInput,
	audiobookshelfRunInput,
]);
export type CreateImportRunBody = z.infer<typeof createImportRunBody>;

export const listedImportRunSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	source: importRunSource,
	status: importRunStatus,
	progress: z.number().int(),
	failedItems: z.number().int(),
	startedAt: z.date().nullable(),
	finishedAt: z.date().nullable(),
	importedItems: z.number().int(),
	processedItems: z.number().int(),
	errorSummary: z.string().nullable(),
	totalItems: z.number().int().nullable(),
	inputSummary: z.record(z.string(), z.unknown()),
});
export type ListedImportRun = z.infer<typeof listedImportRunSchema>;

export const listedImportRunFailureSchema = z.object({
	id: z.string(),
	runId: z.string(),
	message: z.string(),
	createdAt: z.date(),
	itemIndex: z.number().int(),
	stage: importRunFailureStage,
	sourceLabel: z.string().nullable(),
	eventSchemaSlug: z.string().nullable(),
	sourceIdentifier: z.string().nullable(),
	entitySchemaSlug: z.string().nullable(),
	context: z.record(z.string(), z.unknown()).nullable(),
});
export type ListedImportRunFailure = z.infer<typeof listedImportRunFailureSchema>;

export const importRunParams = createIdParamsSchema("runId");

export const getImportRunQuery = z.object({
	page: z.coerce.number().int().positive().default(1),
	limit: z.coerce.number().int().positive().default(20),
});

export const detailedImportRunSchema = listedImportRunSchema.extend({
	failures: z.object({
		page: z.number().int(),
		total: z.number().int(),
		limit: z.number().int(),
		items: z.array(listedImportRunFailureSchema),
	}),
});
export type DetailedImportRun = z.infer<typeof detailedImportRunSchema>;

export const getImportRunResponseSchema = itemDataSchema(detailedImportRunSchema);
export const listImportRunsResponseSchema = listDataSchema(listedImportRunSchema);
export const createImportRunResponseSchema = itemDataSchema(z.object({ id: nonEmptyStringSchema }));
