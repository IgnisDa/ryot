import { z } from "@hono/zod-openapi";

import { dataSchema, itemDataSchema, listDataSchema } from "~/lib/openapi";
import { createIdParamsSchema, nonEmptyStringSchema, positiveIntSchema } from "~/lib/zod";

export const importRunStatus = z.enum(["pending", "running", "completed", "failed"]);
export type ImportRunStatus = z.infer<typeof importRunStatus>;

export const importRunSource = z.enum([
	"hevy",
	"igdb",
	"imdb",
	"plex",
	"trakt",
	"movary",
	"anilist",
	"grouvee",
	"netflix",
	"watcharr",
	"jellyfin",
	"goodreads",
	"hardcover",
	"open_scale",
	"strong_app",
	"storygraph",
	"myanimelist",
	"mediatracker",
	"audiobookshelf",
]);
export type ImportRunSource = z.infer<typeof importRunSource>;

export const importRunFailureStage = z.enum([
	"source_fetch", // authentication or server reachability failures (future API sources)
	"database_commit",
	"provider_details", // provider enrichment failures (future media sources)
	"input_transformation",
]);

export type ImportRunFailureStage = z.infer<typeof importRunFailureStage>;

export const openScaleRunInput = z.object({
	filePath: nonEmptyStringSchema,
	source: z.literal("open_scale"),
});
export type OpenScaleRunInput = z.infer<typeof openScaleRunInput>;

export const createImportRunBody = openScaleRunInput;
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

export const listImportRunFailuresQuery = z.object({
	page: positiveIntSchema.default(1),
	limit: positiveIntSchema.default(20),
});

const importRunsResponseSchema = listDataSchema(listedImportRunSchema);
const importRunFailuresResponseData = z.object({
	page: z.number().int(),
	limit: z.number().int(),
	total: z.number().int(),
	items: z.array(listedImportRunFailureSchema),
});

export const createImportRunResponseSchema = itemDataSchema(z.object({ id: nonEmptyStringSchema }));
export const getImportRunResponseSchema = itemDataSchema(listedImportRunSchema);
export const listImportRunsResponseSchema = importRunsResponseSchema;
export const listImportRunFailuresResponseSchema = dataSchema(importRunFailuresResponseData);
