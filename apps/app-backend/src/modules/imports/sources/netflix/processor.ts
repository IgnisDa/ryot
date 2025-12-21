import { Effect, Either } from "effect";

import { DbRunner } from "~/lib/db";
import { searchGlobalEntities } from "~/modules/entities/population";
import { EntitiesRepository } from "~/modules/entities/repository";

import type {
	LoadedMediaImportAdapterError,
	LoadedMediaImportAdapterResult,
} from "../../media/file-processor";
import { processMediaImport } from "../../media/import-processor";
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

const collectNetflixSearchJobKeys = (adapterInput: NetflixAdapterInput) =>
	Effect.gen(function* () {
		const searchJobKeys = new Set<string>();
		yield* adaptNetflixExports(adapterInput, {
			now: () => "",
			lookupTitle: ({ title, preferredEntitySchemaSlug }) => {
				const query = extractNetflixBaseTitle(title);
				if (!query) {
					return Effect.succeed({ error: "Metadata not found" });
				}
				if (preferredEntitySchemaSlug === "movie") {
					searchJobKeys.add(createNetflixSearchJobKey({ query, scriptSlug: "movie.tmdb" }));
				} else if (preferredEntitySchemaSlug === "show") {
					searchJobKeys.add(createNetflixSearchJobKey({ query, scriptSlug: "show.tmdb" }));
				} else {
					searchJobKeys.add(createNetflixSearchJobKey({ query, scriptSlug: "movie.tmdb" }));
					searchJobKeys.add(createNetflixSearchJobKey({ query, scriptSlug: "show.tmdb" }));
				}
				return Effect.succeed({ error: "Netflix title lookup is pending" });
			},
		});
		return [...searchJobKeys];
	});

const adaptNetflixExportsWithSearchResults = (input: {
	adapterInput: NetflixAdapterInput;
	searchErrors: Map<string, string>;
	searchResults: Map<string, NetflixTitleMatchCandidate[]>;
}) =>
	adaptNetflixExports(input.adapterInput, {
		now: () => "",
		lookupTitle: ({ title, preferredEntitySchemaSlug }) => {
			const query = extractNetflixBaseTitle(title);
			if (!query) {
				return Effect.succeed({ error: "Metadata not found" });
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
				return Effect.succeed({ error: lookupError });
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
					return Effect.succeed({ error: "Metadata not found" });
				}
				if (preferredEntitySchemaSlug) {
					return Effect.succeed({
						error: `Title matched only ${preferredEntitySchemaSlug === "movie" ? "show" : "movie"} results`,
					});
				}
				return Effect.succeed({ error: "Could not match title to a supported movie or show" });
			}

			return Effect.succeed({
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
		let cleanupPaths: ReadonlyArray<string> = [];

		yield* processMediaImport({
			runId: input.runId,
			userId: input.userId,
			sourceName: "Netflix",
			adapterErrorFallback: "Could not parse Netflix export data",
			loadAdapterResult: loadNetflixAdapterResult(input).pipe(
				Effect.tap(({ cleanupPaths: paths }) =>
					Effect.sync(() => {
						cleanupPaths = paths;
					}),
				),
				Effect.map(({ adapterResult }) => adapterResult),
				Effect.mapError((error) => error.message),
			),
		}).pipe(
			Effect.ensuring(
				Effect.suspend(() =>
					Effect.forEach(new Set(cleanupPaths), cleanupImportFile, { discard: true }),
				),
			),
		);
	});

export const loadNetflixAdapterResult = (input: {
	runId: string;
	userId: string;
	filePath?: string;
	sourcePayload?: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const entitiesRepository = yield* EntitiesRepository;

		let extractedDirectoryPath: string | undefined;
		const currentCleanupPaths = () =>
			[filePath, extractedDirectoryPath].filter((path): path is string => Boolean(path));
		const filePath = input.filePath;
		if (!filePath) {
			return yield* Effect.fail({
				cleanupPaths: [],
				message: "Import job is missing Netflix export file",
			} satisfies LoadedMediaImportAdapterError);
		}

		const zipResult = yield* extractImportZipArchive(filePath).pipe(
			Effect.mapError(
				(error) =>
					({
						cleanupPaths: currentCleanupPaths(),
						message: sanitizeErrorMessage(error, "Could not read Netflix export archive"),
					}) satisfies LoadedMediaImportAdapterError,
			),
		);
		extractedDirectoryPath = zipResult.directoryPath;

		const viewingActivityPath = getZipEntryByBasename(zipResult, "ViewingActivity.csv");
		const ratingsPath = getZipEntryByBasename(zipResult, "Ratings.csv");
		const myListPath = getZipEntryByBasename(zipResult, "MyList.csv");
		if (!viewingActivityPath || !ratingsPath || !myListPath) {
			return yield* Effect.fail({
				message: "Required Netflix CSV files were not found in the archive",
				cleanupPaths: currentCleanupPaths(),
			} satisfies LoadedMediaImportAdapterError);
		}

		const [viewingActivityCsv, ratingsCsv, myListCsv] = yield* Effect.all([
			readImportFile(viewingActivityPath),
			readImportFile(ratingsPath),
			readImportFile(myListPath),
		]).pipe(
			Effect.mapError(
				() =>
					({
						cleanupPaths: currentCleanupPaths(),
						message: "Could not read import file",
					}) satisfies LoadedMediaImportAdapterError,
			),
		);

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

		const searchJobKeys = yield* collectNetflixSearchJobKeys(adapterInput).pipe(
			Effect.mapError(
				(error) =>
					({
						cleanupPaths: currentCleanupPaths(),
						message: sanitizeErrorMessage(error, "Could not parse Netflix export data"),
					}) satisfies LoadedMediaImportAdapterError,
			),
		);
		if (searchJobKeys.length === 0) {
			const adapterResult = yield* adaptNetflixExportsWithSearchResults({
				adapterInput,
				searchErrors: new Map(),
				searchResults: new Map(),
			}).pipe(
				Effect.mapError(
					(error) =>
						({
							cleanupPaths: currentCleanupPaths(),
							message: sanitizeErrorMessage(error, "Could not parse Netflix export data"),
						}) satisfies LoadedMediaImportAdapterError,
				),
			);

			return {
				adapterResult,
				cleanupPaths: currentCleanupPaths(),
			} satisfies LoadedMediaImportAdapterResult;
		}

		const [movieScript, showScript] = yield* Effect.all([
			runWithDb(entitiesRepository.findEntitySchemaScriptBySlug("movie.tmdb")),
			runWithDb(entitiesRepository.findEntitySchemaScriptBySlug("show.tmdb")),
		]).pipe(
			Effect.mapError(
				(error) =>
					({
						cleanupPaths: currentCleanupPaths(),
						message: sanitizeErrorMessage(error, "Could not parse Netflix export data"),
					}) satisfies LoadedMediaImportAdapterError,
			),
		);
		if (!movieScript || !showScript) {
			return yield* Effect.fail({
				cleanupPaths: currentCleanupPaths(),
				message: "Netflix importer requires TMDB sandbox scripts",
			} satisfies LoadedMediaImportAdapterError);
		}
		const scriptIdsBySlug: Record<SearchScriptSlug, string> = {
			"show.tmdb": showScript.sandboxScriptId,
			"movie.tmdb": movieScript.sandboxScriptId,
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

		const adapterResult = yield* adaptNetflixExportsWithSearchResults({
			adapterInput,
			searchErrors,
			searchResults,
		}).pipe(
			Effect.mapError(
				(error) =>
					({
						cleanupPaths: currentCleanupPaths(),
						message: sanitizeErrorMessage(error, "Could not parse Netflix export data"),
					}) satisfies LoadedMediaImportAdapterError,
			),
		);

		return {
			adapterResult,
			cleanupPaths: currentCleanupPaths(),
		} satisfies LoadedMediaImportAdapterResult;
	});
