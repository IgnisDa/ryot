// The Netflix title-search glue mirrors the legacy async adapter contract.
// @effect-diagnostics effect/asyncFunction:off
import { Effect, Either } from "effect";

import { DbRunner } from "~/lib/db";
import { searchGlobalEntities } from "~/modules/entities/population";
import { EntitiesRepository } from "~/modules/entities/repository";

import { type MediaImportAdapterResult, processMediaImport } from "../../media/import-processor";
import { sanitizeErrorMessage } from "../../runtime/failures";
import {
	type ExtractImportZipArchiveResult,
	cleanupImportFile,
	extractImportZipArchive,
	readImportFile,
} from "../../runtime/files";
import { adaptNetflixExports } from "./adapter";
import {
	type NetflixTitleMatchCandidate,
	chooseBestNetflixTitleMatch,
	extractNetflixBaseTitle,
} from "./title-matching";

type SearchScriptSlug = "movie.tmdb" | "show.tmdb";

type NetflixAdapterInput = {
	myListCsv: string;
	ratingsCsv: string;
	profileName?: string;
	viewingActivityCsv: string;
};

const createNetflixSearchJobKey = (input: { query: string; scriptSlug: SearchScriptSlug }) =>
	JSON.stringify([input.scriptSlug, input.query]);

const parseNetflixSearchJobKey = (
	searchJobKey: string,
): { query: string; scriptSlug: SearchScriptSlug } => {
	const parsed = JSON.parse(searchJobKey) as unknown;
	if (
		!Array.isArray(parsed) ||
		(parsed[0] !== "movie.tmdb" && parsed[0] !== "show.tmdb") ||
		typeof parsed[1] !== "string"
	) {
		throw new Error("Invalid Netflix search job key");
	}
	return { scriptSlug: parsed[0], query: parsed[1] };
};

const getZipEntryByBasename = (
	zipResult: ExtractImportZipArchiveResult,
	baseName: string,
): string | undefined =>
	zipResult.entries.find((entry) => (entry.fileName.split(/[\\/]/).pop() ?? "") === baseName)
		?.filePath;

const collectNetflixSearchJobKeys = async (
	adapterInput: NetflixAdapterInput,
): Promise<string[]> => {
	const searchJobKeys = new Set<string>();
	await adaptNetflixExports(adapterInput, {
		now: () => "",
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

const adaptNetflixExportsWithSearchResults = (input: {
	adapterInput: NetflixAdapterInput;
	searchErrors: Map<string, string>;
	searchResults: Map<string, NetflixTitleMatchCandidate[]>;
}): Promise<MediaImportAdapterResult> =>
	adaptNetflixExports(input.adapterInput, {
		now: () => "",
		lookupTitle: ({ title, preferredEntitySchemaSlug }) => {
			const query = extractNetflixBaseTitle(title);
			if (!query) {
				return Promise.resolve({ error: "Metadata not found" });
			}

			const movieKey = createNetflixSearchJobKey({ query, scriptSlug: "movie.tmdb" });
			const showKey = createNetflixSearchJobKey({ query, scriptSlug: "show.tmdb" });
			const movieResults = input.searchResults.get(movieKey) ?? [];
			const showResults = input.searchResults.get(showKey) ?? [];
			const requiredSearchJobKeys =
				preferredEntitySchemaSlug === "movie"
					? [movieKey]
					: preferredEntitySchemaSlug === "show"
						? [showKey]
						: [movieKey, showKey];
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
			const match = chooseBestNetflixTitleMatch({ title, results, preferredEntitySchemaSlug });
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

export const processNetflixImport = (input: {
	runId: string;
	userId: string;
	filePath?: string;
	sourcePayload?: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const entitiesRepository = yield* EntitiesRepository;

		let extractedDirectoryPath: string | undefined;

		yield* processMediaImport({
			runId: input.runId,
			userId: input.userId,
			sourceName: "Netflix",
			adapterErrorFallback: "Could not parse Netflix export data",
			loadAdapterResult: Effect.gen(function* () {
				const filePath = input.filePath;
				if (!filePath) {
					return yield* Effect.fail("Import job is missing Netflix export file");
				}

				const zipResult = yield* Effect.tryPromise({
					try: () => extractImportZipArchive(filePath),
					catch: (error) => sanitizeErrorMessage(error, "Could not read Netflix export archive"),
				});
				extractedDirectoryPath = zipResult.directoryPath;

				const viewingActivityPath = getZipEntryByBasename(zipResult, "ViewingActivity.csv");
				const ratingsPath = getZipEntryByBasename(zipResult, "Ratings.csv");
				const myListPath = getZipEntryByBasename(zipResult, "MyList.csv");
				if (!viewingActivityPath || !ratingsPath || !myListPath) {
					return yield* Effect.fail("Required Netflix CSV files were not found in the archive");
				}

				const [viewingActivityCsv, ratingsCsv, myListCsv] = yield* Effect.all([
					readImportFile(viewingActivityPath),
					readImportFile(ratingsPath),
					readImportFile(myListPath),
				]).pipe(Effect.mapError(() => "Could not read import file"));

				const profileName =
					typeof input.sourcePayload?.profileName === "string"
						? input.sourcePayload.profileName
						: undefined;
				const adapterInput: NetflixAdapterInput = {
					myListCsv,
					ratingsCsv,
					profileName,
					viewingActivityCsv,
				};

				const searchJobKeys = yield* Effect.tryPromise({
					try: () => collectNetflixSearchJobKeys(adapterInput),
					catch: (error) => sanitizeErrorMessage(error, "Could not parse Netflix export data"),
				});
				if (searchJobKeys.length === 0) {
					return yield* Effect.tryPromise({
						try: () =>
							adaptNetflixExportsWithSearchResults({
								adapterInput,
								searchErrors: new Map(),
								searchResults: new Map(),
							}),
						catch: (error) => sanitizeErrorMessage(error, "Could not parse Netflix export data"),
					});
				}

				const [movieScript, showScript] = yield* Effect.all([
					runWithDb(entitiesRepository.findEntitySchemaScriptBySlug("movie.tmdb")),
					runWithDb(entitiesRepository.findEntitySchemaScriptBySlug("show.tmdb")),
				]);
				if (!movieScript || !showScript) {
					return yield* Effect.fail("Netflix importer requires TMDB sandbox scripts");
				}
				const scriptIdsBySlug: Record<SearchScriptSlug, string> = {
					"movie.tmdb": movieScript.sandboxScriptId,
					"show.tmdb": showScript.sandboxScriptId,
				};

				const searchErrors = new Map<string, string>();
				const searchResults = new Map<string, NetflixTitleMatchCandidate[]>();
				yield* Effect.forEach(
					searchJobKeys,
					(searchJobKey, index) =>
						Effect.gen(function* () {
							const { query, scriptSlug } = parseNetflixSearchJobKey(searchJobKey);
							const result = yield* searchGlobalEntities({
								query,
								userId: input.userId,
								scriptId: scriptIdsBySlug[scriptSlug],
								executionId: `${input.runId}_netflix_search_${index}`,
							}).pipe(Effect.either);
							if (Either.isLeft(result)) {
								searchErrors.set(searchJobKey, result.left.message);
								return;
							}
							searchResults.set(
								searchJobKey,
								result.right.map((item) => ({
									scriptSlug,
									externalId: item.externalId,
									title: item.titleProperty.value,
									entitySchemaSlug: scriptSlug === "movie.tmdb" ? "movie" : "show",
									publishYear:
										item.primarySubtitleProperty?.kind === "number"
											? item.primarySubtitleProperty.value
											: null,
								})),
							);
						}),
					{ concurrency: 5, discard: true },
				);

				return yield* Effect.tryPromise({
					try: () =>
						adaptNetflixExportsWithSearchResults({ adapterInput, searchErrors, searchResults }),
					catch: (error) => sanitizeErrorMessage(error, "Could not parse Netflix export data"),
				});
			}),
		}).pipe(
			Effect.ensuring(
				Effect.suspend(() =>
					Effect.forEach(
						new Set(
							[input.filePath, extractedDirectoryPath].filter((p): p is string => Boolean(p)),
						),
						cleanupImportFile,
						{ discard: true },
					),
				),
			),
		);
	});
