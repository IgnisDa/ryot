import type { ListedImportSource } from "@ryot-app/contract/modules/imports/schemas";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { importRunRecipe, manualImportRunsRecipe } from "@ryot-app/ryotql-recipes/import-runs";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { Result } from "effect";

const RUNS_LIMIT = 20;
const FAILURES_LIMIT = 25;

const pageInfo = (limit: number, hasMore: boolean) => ({
	limit,
	hasMore,
	nextCursor: hasMore ? "next" : null,
});

export const completedRunRow = {
	progress: 100,
	failedItems: 31,
	totalItems: 2_045,
	failureReason: null,
	status: "completed",
	source: "open_scale",
	importedItems: 2_014,
	processedItems: 2_045,
	id: "run-completed-1",
	createdAt: "2026-03-12T21:40:00.000Z",
	updatedAt: "2026-03-12T21:44:12.000Z",
	startedAt: "2026-03-12T21:40:05.000Z",
	finishedAt: "2026-03-12T21:44:12.000Z",
	inputSummary: { source: "open_scale", fileNames: ["goodreads_library_export.csv"] },
};

export const runningRunRow = {
	progress: 34,
	failedItems: 16,
	finishedAt: null,
	totalItems: 1_204,
	status: "running",
	failureReason: null,
	importedItems: 396,
	processedItems: 412,
	source: "goodreads",
	id: "run-running-1",
	inputSummary: { source: "goodreads" },
	createdAt: "2026-03-13T09:00:00.000Z",
	updatedAt: "2026-03-13T09:02:00.000Z",
	startedAt: "2026-03-13T09:00:00.000Z",
};

export const preparingRunRow = {
	progress: 0,
	failedItems: 0,
	source: "trakt",
	totalItems: null,
	finishedAt: null,
	importedItems: 0,
	processedItems: 0,
	status: "pending",
	failureReason: null,
	id: "run-pending-1",
	inputSummary: { source: "trakt" },
	createdAt: "2026-03-13T09:00:00.000Z",
	updatedAt: "2026-03-13T09:00:00.000Z",
	startedAt: "2026-03-13T09:00:00.000Z",
};

export const failedRunRow = {
	progress: 12,
	failedItems: 0,
	totalItems: null,
	importedItems: 0,
	status: "failed",
	processedItems: 0,
	id: "run-failed-1",
	source: "strong_app",
	createdAt: "2026-03-10T08:00:00.000Z",
	updatedAt: "2026-03-10T08:00:30.000Z",
	startedAt: "2026-03-10T08:00:00.000Z",
	finishedAt: "2026-03-10T08:00:30.000Z",
	inputSummary: { source: "strong_app" },
	failureReason: { code: "source-fetch-failed" },
};

export const unreadableFailureRow = {
	itemIndex: 4,
	eventSchemaSlug: null,
	entitySchemaSlug: null,
	runId: "run-completed-1",
	id: "failure-unreadable-1",
	stage: "input_transformation",
	sourceLabel: "The Long Way Home",
	sourceIdentifier: "goodreads:8231",
	createdAt: "2026-03-12T21:41:00.000Z",
	reason: { code: "input-transformation-failed" },
};

export const unmatchedFailureRow = {
	itemIndex: 11,
	sourceLabel: null,
	eventSchemaSlug: null,
	sourceIdentifier: null,
	runId: "run-completed-1",
	entitySchemaSlug: "book",
	id: "failure-unmatched-1",
	stage: "provider_resolution",
	createdAt: "2026-03-12T21:42:00.000Z",
	reason: { code: "provider-resolution-failed" },
};

export const decodeImportRunList = (
	input: { readonly runs?: readonly unknown[]; readonly hasMore?: boolean } = {},
) =>
	Result.getOrThrow(
		manualImportRunsRecipe({ limit: RUNS_LIMIT }).decode({
			data: {
				importRuns: rowsResult(
					input.runs ?? [completedRunRow],
					pageInfo(RUNS_LIMIT, input.hasMore ?? false),
				),
			},
		}),
	);

export const decodeImportRunDetail = (
	input: {
		readonly run?: unknown;
		readonly hasMore?: boolean;
		readonly failures?: readonly unknown[];
	} = {},
) =>
	Result.getOrThrow(
		importRunRecipe({ runId: "run-completed-1", failureLimit: FAILURES_LIMIT }).decode({
			data: {
				run: rowsResult(
					input.run === null ? [] : [input.run ?? completedRunRow],
					pageInfo(2, false),
				),
				failures: rowsResult(
					input.failures ?? [unreadableFailureRow, unmatchedFailureRow],
					pageInfo(FAILURES_LIMIT, input.hasMore ?? false),
				),
			},
		}),
	);

export const uploadImportSchema = (
	input: { readonly label?: string; readonly extensions?: readonly string[] } = {},
) =>
	({
		unknownKeys: "strict",
		fields: {
			archiveUploadToken: {
				type: "string",
				validation: { required: true },
				label: input.label ?? "Export archive",
				description: "The export file from your account",
				format: { kind: "upload", allowedFileExtensions: input.extensions ?? ["csv"] },
			},
		},
	}) satisfies AppSchema;

export const credentialImportSchema = {
	unknownKeys: "strict",
	fields: {
		apiKey: {
			secret: true,
			type: "string",
			label: "API key",
			validation: { required: true },
			description: "The key from your account settings",
		},
		includeArchived: {
			type: "boolean",
			defaultValue: false,
			label: "Include archived",
			description: "Also bring over archived entries",
		},
	},
} satisfies AppSchema;

export const listedImportSource = (
	input: Partial<ListedImportSource> & { readonly slug: string; readonly name: string },
): ListedImportSource => ({
	isStartable: true,
	pluginSlug: "media",
	exportHelp: undefined,
	workflowSlug: "import",
	missingPluginConfigKeys: [],
	requiredPluginConfigKeys: [],
	inputSchema: uploadImportSchema(),
	description: `Bring your history over from ${input.name}`,
	...input,
});
