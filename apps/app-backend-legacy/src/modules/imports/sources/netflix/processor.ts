import node_path from "node:path";

import { dayjs } from "@ryot/ts-utils/dayjs";
import type { Job } from "bullmq";
import { z } from "zod";

import { sha1Hex } from "~/lib/bun";
import {
	getSandboxChildRunResults,
	queueSandboxChildJobsBatch,
	waitForSandboxChildRun,
} from "~/lib/sandbox/child-run";
import { getBuiltinSandboxScriptBySlug } from "~/modules/sandbox";

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

const searchScriptSlugSchema = z.enum(["movie.tmdb", "show.tmdb"]);
type SearchScriptSlug = z.infer<typeof searchScriptSlugSchema>;

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

type NetflixSearchAdapterInput = {
	myListCsv: string;
	ratingsCsv: string;
	profileName?: string;
	viewingActivityCsv: string;
};

type NetflixCsvPaths = {
	myListPath: string;
	ratingsPath: string;
	viewingActivityPath: string;
	extractedDirectoryPath?: string;
};

export type NetflixImportProcessorDeps = {
	now: () => string;
	readImportFile: typeof readImportFile;
	cleanupImportFile: typeof cleanupImportFile;
	processMediaImport: typeof processMediaImport;
	adaptNetflixExports: typeof adaptNetflixExports;
	extractImportZipArchive: typeof extractImportZipArchive;
	queueSandboxChildJobsBatch: typeof queueSandboxChildJobsBatch;
	getSandboxChildRunResults: typeof getSandboxChildRunResults;
	getBuiltinSandboxScriptBySlug: typeof getBuiltinSandboxScriptBySlug;
	waitForSandboxChildRun: typeof waitForSandboxChildRun;
};

const netflixImportProcessorDeps: NetflixImportProcessorDeps = {
	now: () => dayjs().toISOString(),
	readImportFile,
	cleanupImportFile,
	processMediaImport,
	adaptNetflixExports,
	extractImportZipArchive,
	queueSandboxChildJobsBatch,
	getSandboxChildRunResults,
	getBuiltinSandboxScriptBySlug,
	waitForSandboxChildRun,
};

const createNetflixSearchJobKey = (input: { query: string; scriptSlug: SearchScriptSlug }) =>
	JSON.stringify([input.scriptSlug, input.query]);

const parseNetflixSearchJobKey = (searchJobKey: string) => {
	const tupleSchema = z.tuple([searchScriptSlugSchema, z.string().min(1)]);
	const [scriptSlug, query] = tupleSchema.parse(JSON.parse(searchJobKey));
	return { query, scriptSlug };
};

const createNetflixSearchChildJobId = (job: Job, searchJobKey: string) =>
	`${job.id}_netflix_search_${sha1Hex(searchJobKey)}`;

const getSearchResults = (input: {
	value: unknown;
	scriptSlug: SearchScriptSlug;
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

const getNetflixAdapterInput = (input: {
	myListCsv: string;
	ratingsCsv: string;
	profileName?: unknown;
	viewingActivityCsv: string;
}): NetflixSearchAdapterInput => ({
	myListCsv: input.myListCsv,
	ratingsCsv: input.ratingsCsv,
	viewingActivityCsv: input.viewingActivityCsv,
	profileName: typeof input.profileName === "string" ? input.profileName : undefined,
});

const resolveNetflixCsvPaths = async (input: {
	filePath?: string;
	deps: NetflixImportProcessorDeps;
	netflixMyListPath?: string;
	netflixRatingsPath?: string;
	netflixViewingActivityPath?: string;
	netflixExtractedDirectoryPath?: string;
	onExtractedDirectoryPath: (path: string) => void;
}): Promise<NetflixCsvPaths> => {
	if (input.netflixViewingActivityPath && input.netflixRatingsPath && input.netflixMyListPath) {
		return {
			myListPath: input.netflixMyListPath,
			ratingsPath: input.netflixRatingsPath,
			viewingActivityPath: input.netflixViewingActivityPath,
			extractedDirectoryPath: input.netflixExtractedDirectoryPath,
		};
	}

	if (!input.filePath) {
		throw new Error("Import job is missing Netflix export file");
	}

	const zipResult = await input.deps.extractImportZipArchive(input.filePath);
	input.onExtractedDirectoryPath(zipResult.directoryPath);
	const viewingActivityPath = getZipEntryByBasename(zipResult, "ViewingActivity.csv");
	const ratingsPath = getZipEntryByBasename(zipResult, "Ratings.csv");
	const myListPath = getZipEntryByBasename(zipResult, "MyList.csv");
	if (!viewingActivityPath || !ratingsPath || !myListPath) {
		throw new Error("Required Netflix CSV files were not found in the archive");
	}

	return {
		myListPath,
		ratingsPath,
		viewingActivityPath,
		extractedDirectoryPath: zipResult.directoryPath,
	};
};

const collectNetflixSearchJobKeys = async (input: {
	deps: NetflixImportProcessorDeps;
	adapterInput: NetflixSearchAdapterInput;
}) => {
	const searchJobKeys = new Set<string>();
	await input.deps.adaptNetflixExports(input.adapterInput, {
		now: input.deps.now,
		lookupTitle: ({ title, preferredEntitySchemaSlug }) => {
			const query = extractNetflixBaseTitle(title);
			if (!query) {
				return Promise.resolve({ error: "Metadata not found" });
			}

			if (preferredEntitySchemaSlug === "movie") {
				searchJobKeys.add(createNetflixSearchJobKey({ query, scriptSlug: "movie.tmdb" }));
			} else if (preferredEntitySchemaSlug === "show") {
				searchJobKeys.add(createNetflixSearchJobKey({ query, scriptSlug: "show.tmdb" }));
			} else {
				searchJobKeys.add(createNetflixSearchJobKey({ query, scriptSlug: "movie.tmdb" }));
				searchJobKeys.add(createNetflixSearchJobKey({ query, scriptSlug: "show.tmdb" }));
			}

			return Promise.resolve({ error: "Netflix title lookup is pending" });
		},
	});

	return [...searchJobKeys];
};

const adaptNetflixExportsWithSearchResults = async (input: {
	deps: NetflixImportProcessorDeps;
	adapterInput: NetflixSearchAdapterInput;
	searchErrors: Map<string, string>;
	searchResults: Map<string, NetflixTitleMatchCandidate[]>;
}): Promise<MediaImportAdapterResult> =>
	input.deps.adaptNetflixExports(input.adapterInput, {
		now: input.deps.now,
		lookupTitle: ({ title, preferredEntitySchemaSlug }) => {
			const query = extractNetflixBaseTitle(title);
			if (!query) {
				return Promise.resolve({ error: "Metadata not found" });
			}

			const movieResults =
				input.searchResults.get(createNetflixSearchJobKey({ query, scriptSlug: "movie.tmdb" })) ??
				[];
			const showResults =
				input.searchResults.get(createNetflixSearchJobKey({ query, scriptSlug: "show.tmdb" })) ??
				[];
			const requiredSearchJobKeys =
				preferredEntitySchemaSlug === "movie"
					? [createNetflixSearchJobKey({ query, scriptSlug: "movie.tmdb" })]
					: preferredEntitySchemaSlug === "show"
						? [createNetflixSearchJobKey({ query, scriptSlug: "show.tmdb" })]
						: [
								createNetflixSearchJobKey({ query, scriptSlug: "movie.tmdb" }),
								createNetflixSearchJobKey({ query, scriptSlug: "show.tmdb" }),
							];
			const lookupError = requiredSearchJobKeys
				.map((searchJobKey) => input.searchErrors.get(searchJobKey))
				.find((error): error is string => Boolean(error));
			if (lookupError) {
				return Promise.resolve({ error: lookupError });
			}
			const results =
				preferredEntitySchemaSlug === "movie"
					? movieResults
					: preferredEntitySchemaSlug === "show"
						? showResults
						: [...movieResults, ...showResults];
			const match = chooseBestNetflixTitleMatch({
				title,
				results,
				preferredEntitySchemaSlug,
			});
			if (!match) {
				if (results.length === 0) {
					return Promise.resolve({ error: "Metadata not found" });
				}
				if (preferredEntitySchemaSlug) {
					return Promise.resolve({
						error: `Title matched only ${preferredEntitySchemaSlug === "movie" ? "show" : "movie"} results`,
					});
				}

				return Promise.resolve({ error: "Could not match title to a supported movie or show" });
			}

			return Promise.resolve({
				matchedTitle: match.title,
				entityRef: {
					kind: "resolved",
					sourceLabel: match.title,
					externalId: match.externalId,
					scriptSlug: match.scriptSlug,
					entitySchemaSlug: match.entitySchemaSlug,
				},
			});
		},
	});

const loadAdapterResultFromSearchJobs = async (input: {
	job: Job;
	deps: NetflixImportProcessorDeps;
	searchJobs: Record<string, string>;
	adapterInput: NetflixSearchAdapterInput;
}) => {
	const searchJobResults = await input.deps.getSandboxChildRunResults({
		job: input.job,
		sandboxChildJobIds: Object.values(input.searchJobs),
	});
	const searchErrors = new Map<string, string>();
	const searchResults = new Map<string, NetflixTitleMatchCandidate[]>();
	for (const [searchJobKey, childJobId] of Object.entries(input.searchJobs)) {
		const searchJobResult = searchJobResults[childJobId];
		if (!searchJobResult?.success) {
			searchErrors.set(searchJobKey, searchJobResult?.error ?? "Sandbox search job failed");
			continue;
		}
		if (searchJobResult.error) {
			searchErrors.set(searchJobKey, searchJobResult.error);
			continue;
		}

		try {
			const { scriptSlug } = parseNetflixSearchJobKey(searchJobKey);
			searchResults.set(
				searchJobKey,
				getSearchResults({ value: searchJobResult.value, scriptSlug }),
			);
		} catch (error) {
			searchErrors.set(
				searchJobKey,
				error instanceof Error
					? error.message
					: "Sandbox search job returned an unexpected result shape",
			);
		}
	}

	return adaptNetflixExportsWithSearchResults({
		deps: input.deps,
		adapterInput: input.adapterInput,
		searchErrors,
		searchResults,
	});
};

export const processNetflixImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & { filePath?: string; sourcePayload?: Record<string, unknown> },
	deps: NetflixImportProcessorDeps = netflixImportProcessorDeps,
): Promise<void> => {
	let extractedDirectoryPath = input.netflixExtractedDirectoryPath;

	await deps.processMediaImport(job, token, {
		...input,
		sourceName: "Netflix",
		adapterErrorFallback: "Could not parse Netflix export data",
		cleanup: async () => {
			const cleanupTargets = [input.filePath, extractedDirectoryPath].filter(
				(path): path is string => Boolean(path),
			);
			await Promise.all(cleanupTargets.map((path) => deps.cleanupImportFile(path)));
		},
		loadAdapterResult: async (): Promise<MediaImportAdapterResult> => {
			const csvPaths = await resolveNetflixCsvPaths({
				deps,
				filePath: input.filePath,
				netflixMyListPath: input.netflixMyListPath,
				netflixRatingsPath: input.netflixRatingsPath,
				netflixViewingActivityPath: input.netflixViewingActivityPath,
				netflixExtractedDirectoryPath: input.netflixExtractedDirectoryPath,
				onExtractedDirectoryPath: (path) => {
					extractedDirectoryPath = path;
				},
			});

			const [viewingActivityCsv, ratingsCsv, myListCsv] = await Promise.all([
				deps.readImportFile(csvPaths.viewingActivityPath),
				deps.readImportFile(csvPaths.ratingsPath),
				deps.readImportFile(csvPaths.myListPath),
			]);
			const adapterInput = getNetflixAdapterInput({
				myListCsv,
				ratingsCsv,
				viewingActivityCsv,
				profileName: input.sourcePayload?.profileName,
			});

			if (input.importStep === "loading_adapter" && input.netflixSearchJobs) {
				return loadAdapterResultFromSearchJobs({
					job,
					deps,
					adapterInput,
					searchJobs: input.netflixSearchJobs,
				});
			}

			const searchJobKeys = await collectNetflixSearchJobKeys({ deps, adapterInput });
			if (searchJobKeys.length === 0) {
				return adaptNetflixExportsWithSearchResults({
					deps,
					adapterInput,
					searchErrors: new Map(),
					searchResults: new Map(),
				});
			}

			const [movieScript, showScript] = await Promise.all([
				deps.getBuiltinSandboxScriptBySlug("movie.tmdb"),
				deps.getBuiltinSandboxScriptBySlug("show.tmdb"),
			]);
			if (!movieScript || !showScript) {
				throw new Error("Netflix importer requires TMDB sandbox scripts");
			}

			const scriptIdsBySlug = new Map<SearchScriptSlug, string>([
				["movie.tmdb", movieScript.id],
				["show.tmdb", showScript.id],
			]);
			const netflixSearchJobs = Object.fromEntries(
				searchJobKeys.map((searchJobKey) => [
					searchJobKey,
					createNetflixSearchChildJobId(job, searchJobKey),
				]),
			);

			await deps.queueSandboxChildJobsBatch({
				job,
				children: searchJobKeys.map((searchJobKey) => {
					const childJobId = netflixSearchJobs[searchJobKey];
					if (!childJobId) {
						throw new Error(`Netflix search job id missing for key '${searchJobKey}'`);
					}

					const { query, scriptSlug } = parseNetflixSearchJobKey(searchJobKey);
					const scriptId = scriptIdsBySlug.get(scriptSlug);
					if (!scriptId) {
						throw new Error(`Netflix importer is missing sandbox script '${scriptSlug}'`);
					}

					return {
						childJobId,
						sandboxJobData: {
							userId: input.userId,
							driverName: "search",
							scriptId,
							context: { page: 1, query, pageSize: 5 },
						},
					};
				}),
				jobData: {
					...input,
					filePath: input.filePath,
					sourcePayload: input.sourcePayload,
					importStep: "loading_adapter",
					netflixSearchJobs,
					netflixMyListPath: csvPaths.myListPath,
					netflixRatingsPath: csvPaths.ratingsPath,
					netflixViewingActivityPath: csvPaths.viewingActivityPath,
					netflixExtractedDirectoryPath: csvPaths.extractedDirectoryPath,
				},
			});
			await deps.waitForSandboxChildRun(job, token);

			return loadAdapterResultFromSearchJobs({
				job,
				deps,
				adapterInput,
				searchJobs: netflixSearchJobs,
			});
		},
	});
};
