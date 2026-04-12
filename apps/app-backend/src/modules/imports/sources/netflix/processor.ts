import node_path from "node:path";

import { dayjs } from "@ryot/ts-utils/dayjs";
import { QueueEvents, type Job } from "bullmq";
import { z } from "zod";

import { getQueues } from "~/lib/queue";
import { getRedisConnection } from "~/lib/queue/connection";
import { sandboxRunJobResult } from "~/lib/sandbox/jobs";
import { enqueueSandbox, getBuiltinSandboxScriptBySlug } from "~/modules/sandbox";

import {
	processMediaImport,
	type MediaImportAdapterResult,
	type MediaImportJobInput,
} from "../../media/import-processor";
import {
	cleanupImportFile,
	extractImportZipArchive,
	readImportFile,
	type ExtractImportZipArchiveResult,
} from "../../runtime/files";
import { adaptNetflixExports } from "./adapter";
import {
	chooseBestNetflixTitleMatch,
	extractNetflixBaseTitle,
	type NetflixTitleMatchCandidate,
} from "./title-matching";

const SANDBOX_SEARCH_TIMEOUT_MS = 30000;

const sandboxSearchResultSchema = z.object({
	items: z.array(
		z.object({
			externalId: z.string().min(1),
			titleProperty: z.object({ kind: z.literal("text"), value: z.string().min(1) }),
			primarySubtitleProperty: z
				.union([
					z.object({ kind: z.literal("number"), value: z.number() }),
					z.object({ kind: z.literal("null"), value: z.null() }),
				])
				.optional(),
		}),
	),
});

export type NetflixImportProcessorDeps = {
	now: () => string;
	createQueueEvents: () => QueueEvents;
	readImportFile: typeof readImportFile;
	enqueueSandbox: typeof enqueueSandbox;
	cleanupImportFile: typeof cleanupImportFile;
	processMediaImport: typeof processMediaImport;
	adaptNetflixExports: typeof adaptNetflixExports;
	extractImportZipArchive: typeof extractImportZipArchive;
	getBuiltinSandboxScriptBySlug: typeof getBuiltinSandboxScriptBySlug;
	waitForSandboxResult: (input: { jobId: string; queueEvents: QueueEvents }) => Promise<unknown>;
};

const netflixImportProcessorDeps: NetflixImportProcessorDeps = {
	readImportFile,
	enqueueSandbox,
	cleanupImportFile,
	processMediaImport,
	adaptNetflixExports,
	extractImportZipArchive,
	getBuiltinSandboxScriptBySlug,
	now: () => dayjs().toISOString(),
	createQueueEvents: () => new QueueEvents("sandbox", { connection: getRedisConnection() }),
	waitForSandboxResult: async (input) => {
		const job = await getQueues().sandboxQueue.getJob(input.jobId);
		if (!job) {
			throw new Error("Sandbox search job was not created");
		}

		const result = await job.waitUntilFinished(input.queueEvents, SANDBOX_SEARCH_TIMEOUT_MS);
		const parsed = sandboxRunJobResult.safeParse(result);
		if (!parsed.success) {
			throw new Error("Sandbox search job returned an invalid payload");
		}
		if (!parsed.data.success || parsed.data.error) {
			throw new Error(parsed.data.error ?? "Sandbox search job failed");
		}
		return parsed.data.value;
	},
};

const getSearchResults = (input: {
	value: unknown;
	scriptSlug: "movie.tmdb" | "show.tmdb";
}): NetflixTitleMatchCandidate[] => {
	const parsed = sandboxSearchResultSchema.safeParse(input.value);
	if (!parsed.success) {
		throw new Error("Sandbox search job returned an unexpected result shape");
	}

	return parsed.data.items.map((item) => ({
		externalId: item.externalId,
		scriptSlug: input.scriptSlug,
		title: item.titleProperty.value,
		entitySchemaSlug: input.scriptSlug === "movie.tmdb" ? "movie" : "show",
		publishYear:
			item.primarySubtitleProperty?.kind === "number" ? item.primarySubtitleProperty.value : null,
	}));
};

const getZipEntryByBasename = (
	zipResult: ExtractImportZipArchiveResult,
	baseName: string,
): string | undefined =>
	zipResult.entries.find((entry) => node_path.basename(entry.fileName) === baseName)?.filePath;

export const processNetflixImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & { filePath?: string; sourcePayload?: Record<string, unknown> },
	deps: NetflixImportProcessorDeps = netflixImportProcessorDeps,
): Promise<void> => {
	let queueEvents: QueueEvents | undefined;
	let extractedDirectoryPath: string | undefined;

	try {
		await deps.processMediaImport(job, token, {
			...input,
			sourceName: "Netflix",
			adapterErrorFallback: "Could not parse Netflix export data",
			cleanup: async () => {
				if (input.filePath) {
					await deps.cleanupImportFile(input.filePath);
				}
				if (extractedDirectoryPath) {
					await deps.cleanupImportFile(extractedDirectoryPath);
				}
			},
			loadAdapterResult: async (): Promise<MediaImportAdapterResult> => {
				if (!input.filePath) {
					throw new Error("Import job is missing Netflix export file");
				}

				const zipResult = await deps.extractImportZipArchive(input.filePath);
				extractedDirectoryPath = zipResult.directoryPath;
				const viewingActivityPath = getZipEntryByBasename(zipResult, "ViewingActivity.csv");
				const ratingsPath = getZipEntryByBasename(zipResult, "Ratings.csv");
				const myListPath = getZipEntryByBasename(zipResult, "MyList.csv");
				if (!viewingActivityPath || !ratingsPath || !myListPath) {
					throw new Error("Required Netflix CSV files were not found in the archive");
				}

				const [viewingActivityCsv, ratingsCsv, myListCsv] = await Promise.all([
					deps.readImportFile(viewingActivityPath),
					deps.readImportFile(ratingsPath),
					deps.readImportFile(myListPath),
				]);

				const activeQueueEvents = deps.createQueueEvents();
				queueEvents = activeQueueEvents;
				await activeQueueEvents.waitUntilReady();
				const searchCache = new Map<string, Promise<NetflixTitleMatchCandidate[]>>();
				const [movieScript, showScript] = await Promise.all([
					deps.getBuiltinSandboxScriptBySlug("movie.tmdb"),
					deps.getBuiltinSandboxScriptBySlug("show.tmdb"),
				]);
				if (!movieScript || !showScript) {
					throw new Error("Netflix importer requires TMDB sandbox scripts");
				}

				const runSearch = async (searchInput: {
					query: string;
					userId: string;
					scriptId: string;
					scriptSlug: "movie.tmdb" | "show.tmdb";
				}) => {
					const searchResult = await deps.enqueueSandbox({
						userId: searchInput.userId,
						body: {
							driverName: "search",
							scriptId: searchInput.scriptId,
							context: { page: 1, query: searchInput.query, pageSize: 5 },
						},
					});
					if ("error" in searchResult) {
						throw new Error(searchResult.message);
					}

					const searchValue = await deps.waitForSandboxResult({
						jobId: searchResult.data.jobId,
						queueEvents: activeQueueEvents,
					});
					return getSearchResults({ value: searchValue, scriptSlug: searchInput.scriptSlug });
				};

				const loadSearchCandidates = async (searchInput: {
					query: string;
					userId: string;
					preferredEntitySchemaSlug?: "movie" | "show";
				}) => {
					if (searchInput.preferredEntitySchemaSlug === "movie") {
						return runSearch({
							query: searchInput.query,
							userId: searchInput.userId,
							scriptId: movieScript.id,
							scriptSlug: "movie.tmdb",
						});
					}

					if (searchInput.preferredEntitySchemaSlug === "show") {
						return runSearch({
							query: searchInput.query,
							userId: searchInput.userId,
							scriptId: showScript.id,
							scriptSlug: "show.tmdb",
						});
					}

					const [movieResults, showResults] = await Promise.all([
						runSearch({
							query: searchInput.query,
							userId: searchInput.userId,
							scriptId: movieScript.id,
							scriptSlug: "movie.tmdb",
						}),
						runSearch({
							query: searchInput.query,
							userId: searchInput.userId,
							scriptId: showScript.id,
							scriptSlug: "show.tmdb",
						}),
					]);

					return [...movieResults, ...showResults];
				};

				return deps.adaptNetflixExports(
					{
						myListCsv,
						ratingsCsv,
						viewingActivityCsv,
						profileName:
							typeof input.sourcePayload?.profileName === "string"
								? input.sourcePayload.profileName
								: undefined,
					},
					{
						lookupTitle: async ({ title, preferredEntitySchemaSlug }) => {
							const query = extractNetflixBaseTitle(title);
							if (!query) {
								return { error: "Metadata not found" };
							}

							const cacheKey = `${preferredEntitySchemaSlug ?? "all"}:${query}`;
							let searchPromise = searchCache.get(cacheKey);
							if (!searchPromise) {
								searchPromise = loadSearchCandidates({
									query,
									userId: input.userId,
									preferredEntitySchemaSlug,
								});
								searchCache.set(cacheKey, searchPromise);
							}

							const results = await searchPromise;
							const match = chooseBestNetflixTitleMatch({
								title,
								results,
								preferredEntitySchemaSlug,
							});
							if (!match) {
								if (results.length === 0) {
									return { error: "Metadata not found" };
								}
								if (preferredEntitySchemaSlug) {
									return {
										error: `Title matched only ${preferredEntitySchemaSlug === "movie" ? "show" : "movie"} results`,
									};
								}
								return { error: "Could not match title to a supported movie or show" };
							}

							return {
								matchedTitle: match.title,
								entityRef: {
									kind: "resolved",
									sourceLabel: match.title,
									externalId: match.externalId,
									scriptSlug: match.scriptSlug,
									entitySchemaSlug: match.entitySchemaSlug,
								},
							};
						},
						now: deps.now,
					},
				);
			},
		});
	} finally {
		await queueEvents?.close();
	}
};
