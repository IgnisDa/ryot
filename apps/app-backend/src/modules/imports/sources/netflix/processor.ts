import { FileSystem } from "@effect/platform";
import type { ImportRunId, UserId } from "@ryot/contract/schema/brands";
import type { ProviderSearchItem } from "@ryot/sandbox-sdk/provider";
import { Effect, Match } from "effect";

import {
	type MetadataLookupTitleMatchCandidate,
	chooseBestMetadataLookupTitleMatch,
} from "#lib/shared/title-matching";
import { extractMetadataLookupBaseTitle } from "#lib/shared/title-parsing";

import type { MediaImportAdapterResult } from "../../media/adapter-result";
import { nowIso } from "../../media/dates";
import type { LoadedMediaImportAdapterError } from "../../media/file-processor";
import {
	type ExtractImportZipArchiveResult,
	extractImportZipArchive,
	readImportFile,
} from "../../runtime/import-files";
import { sanitizeErrorMessage } from "../../runtime/import-run-status";
import { adaptNetflixExports } from "./adapter";

type SearchProviderSlug = "movie.tmdb" | "show.tmdb";

type NetflixAdapterInput = {
	myListCsv: string;
	importedAt: string;
	ratingsCsv: string;
	viewingActivityCsv: string;
	profileName?: string | undefined;
};

type NetflixSearchJob = {
	query: string;
	jobKey: string;
	providerSlug: SearchProviderSlug;
};

type NetflixSearchResponse = {
	jobKey: string;
	error: string | null;
	items: ReadonlyArray<ProviderSearchItem>;
};

type LoadedNetflixAdapterResult =
	| {
			_tag: "loaded";
			cleanupPaths: ReadonlyArray<string>;
			adapterResult: MediaImportAdapterResult;
	  }
	| {
			importedAt: string;
			myListPath: string;
			ratingsPath: string;
			viewingActivityPath: string;
			_tag: "netflix-search-planned";
			profileName?: string | undefined;
			cleanupPaths: ReadonlyArray<string>;
			searchJobs: ReadonlyArray<NetflixSearchJob>;
	  };

const createNetflixSearchJobKey = (input: { query: string; providerSlug: SearchProviderSlug }) =>
	JSON.stringify([input.providerSlug, input.query]);

const parseNetflixSearchJobKey = (
	searchJobKey: string,
): { query: string; providerSlug: SearchProviderSlug } => {
	const parsed = JSON.parse(searchJobKey) as unknown;
	if (
		!Array.isArray(parsed) ||
		(parsed[0] !== "movie.tmdb" && parsed[0] !== "show.tmdb") ||
		typeof parsed[1] !== "string"
	) {
		throw new Error("Invalid Netflix search job key");
	}
	return { providerSlug: parsed[0], query: parsed[1] };
};

const getZipEntryByBasename = (
	zipResult: ExtractImportZipArchiveResult,
	baseName: string,
): string | undefined =>
	zipResult.entries.find((entry) => (entry.fileName.split(/[\\/]/).pop() ?? "") === baseName)
		?.filePath;

const collectNetflixSearchJobKeys = Effect.fn(function* (adapterInput: NetflixAdapterInput) {
	const searchJobKeys = new Set<string>();
	yield* adaptNetflixExports(adapterInput, ({ title, preferredEntitySchemaSlug }) => {
		const query = extractMetadataLookupBaseTitle(title);
		if (!query) {
			return Effect.fail("Metadata not found");
		}
		if (preferredEntitySchemaSlug === "movie") {
			searchJobKeys.add(createNetflixSearchJobKey({ query, providerSlug: "movie.tmdb" }));
		} else if (preferredEntitySchemaSlug === "show") {
			searchJobKeys.add(createNetflixSearchJobKey({ query, providerSlug: "show.tmdb" }));
		} else {
			searchJobKeys.add(createNetflixSearchJobKey({ query, providerSlug: "movie.tmdb" }));
			searchJobKeys.add(createNetflixSearchJobKey({ query, providerSlug: "show.tmdb" }));
		}
		return Effect.fail("Netflix title lookup is pending");
	});
	return [...searchJobKeys];
});

const adaptNetflixExportsWithSearchResults = (input: {
	adapterInput: NetflixAdapterInput;
	searchErrors: Map<string, string>;
	searchResults: Map<string, MetadataLookupTitleMatchCandidate[]>;
}) =>
	adaptNetflixExports(input.adapterInput, ({ title, preferredEntitySchemaSlug }) => {
		const query = extractMetadataLookupBaseTitle(title);
		if (!query) {
			return Effect.fail("Metadata not found");
		}

		const movieKey = createNetflixSearchJobKey({ query, providerSlug: "movie.tmdb" });
		const showKey = createNetflixSearchJobKey({ query, providerSlug: "show.tmdb" });
		const movieResults = input.searchResults.get(movieKey) ?? [];
		const showResults = input.searchResults.get(showKey) ?? [];
		const requiredSearchJobKeys = Match.value(preferredEntitySchemaSlug).pipe(
			Match.when("movie", () => [movieKey]),
			Match.when("show", () => [showKey]),
			Match.when(Match.undefined, () => [movieKey, showKey]),
			Match.exhaustive,
		);
		const lookupError = requiredSearchJobKeys
			.map((searchJobKey) => input.searchErrors.get(searchJobKey))
			.find((error): error is string => Boolean(error));
		if (lookupError) {
			return Effect.fail(lookupError);
		}

		const results = Match.value(preferredEntitySchemaSlug).pipe(
			Match.when("movie", () => movieResults),
			Match.when("show", () => showResults),
			Match.when(Match.undefined, () => [...movieResults, ...showResults]),
			Match.exhaustive,
		);
		const bestMatch = chooseBestMetadataLookupTitleMatch({
			title,
			results,
			preferredEntitySchemaSlug,
		});
		if (!bestMatch) {
			if (results.length === 0) {
				return Effect.fail("Metadata not found");
			}
			if (preferredEntitySchemaSlug) {
				return Effect.fail(
					`Title matched only ${preferredEntitySchemaSlug === "movie" ? "show" : "movie"} results`,
				);
			}
			return Effect.fail("Could not match title to a supported movie or show");
		}

		return Effect.succeed({
			matchedTitle: bestMatch.title,
			entityRef: {
				kind: "resolved",
				sourceLabel: bestMatch.title,
				externalId: bestMatch.externalId,
				providerSlug: bestMatch.scriptSlug,
				entitySchemaSlug: bestMatch.entitySchemaSlug,
			},
		});
	});

const toNetflixTitleMatchCandidates = (
	searchJobKey: string,
	items: ReadonlyArray<ProviderSearchItem>,
): ReadonlyArray<MetadataLookupTitleMatchCandidate> => {
	const { providerSlug } = parseNetflixSearchJobKey(searchJobKey);
	return items.map((item) => ({
		scriptSlug: providerSlug,
		externalId: item.externalId,
		title: item.titleProperty.value,
		entitySchemaSlug: providerSlug === "movie.tmdb" ? "movie" : "show",
		publishYear:
			item.primarySubtitleProperty?.kind === "number" ? item.primarySubtitleProperty.value : null,
	}));
};

export const buildNetflixAdapterResult = Effect.fn("netflixProcessor.buildResult")(
	function* (input: {
		importedAt: string;
		myListPath: string;
		ratingsPath: string;
		profileName?: string | undefined;
		viewingActivityPath: string;
		searchResponses: ReadonlyArray<NetflixSearchResponse>;
	}) {
		const fs = yield* FileSystem.FileSystem;
		const [viewingActivityCsv, ratingsCsv, myListCsv] = yield* Effect.all(
			[
				fs.readFileString(input.viewingActivityPath),
				fs.readFileString(input.ratingsPath),
				fs.readFileString(input.myListPath),
			],
			{ concurrency: 3 },
		).pipe(Effect.mapError(() => "Could not read import file"));

		const searchErrors = new Map<string, string>();
		const searchResults = new Map<string, MetadataLookupTitleMatchCandidate[]>();
		for (const response of input.searchResponses) {
			if (response.error) {
				searchErrors.set(response.jobKey, response.error);
				continue;
			}

			searchResults.set(response.jobKey, [
				...toNetflixTitleMatchCandidates(response.jobKey, response.items),
			]);
		}

		return yield* adaptNetflixExportsWithSearchResults({
			searchErrors,
			searchResults,
			adapterInput: {
				myListCsv,
				ratingsCsv,
				viewingActivityCsv,
				importedAt: input.importedAt,
				profileName: input.profileName,
			},
		}).pipe(
			Effect.mapError((error) =>
				sanitizeErrorMessage(error, "Could not parse Netflix export data"),
			),
		);
	},
);

export const loadNetflixAdapterResult = Effect.fn("netflixProcessor.load")(function* (input: {
	runId: ImportRunId;
	userId: UserId;
	filePath?: string | undefined;
	sourcePayload?: Record<string, unknown> | undefined;
}) {
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
		typeof input.sourcePayload?.["profileName"] === "string"
			? input.sourcePayload["profileName"]
			: undefined;
	const importedAt = nowIso();
	const adapterInput: NetflixAdapterInput = {
		importedAt,
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
			_tag: "loaded",
			cleanupPaths: currentCleanupPaths(),
		} satisfies LoadedNetflixAdapterResult;
	}

	return {
		importedAt,
		myListPath,
		profileName,
		ratingsPath,
		viewingActivityPath,
		_tag: "netflix-search-planned",
		cleanupPaths: currentCleanupPaths(),
		searchJobs: searchJobKeys.map((jobKey) => {
			const { query, providerSlug } = parseNetflixSearchJobKey(jobKey);
			return { query, jobKey, providerSlug };
		}),
	} satisfies LoadedNetflixAdapterResult;
});
