import type { FileSystem, HttpClient, Path } from "@effect/platform";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import type { DbRunner } from "#lib/infrastructure/db/service";
import type { RedisService } from "#lib/infrastructure/redis";
import type { EntitiesRepository } from "#modules/entities/repository";

import type { ImportRunJobData } from "../jobs";
import { resolveSafeImportFilePath, validateFileExtension } from "../runtime/import-files";
import { sanitizeErrorMessage } from "../runtime/import-run-status";
import { makeImporterConfig } from "../runtime/importer-config";
import { getKnownImportExtensions } from "../runtime/source-definitions";
import { loadImportSourcePayload } from "../runtime/source-payload-store";
import { adaptAnilistExport } from "../sources/anilist/adapter";
import { adaptAudiobookshelfData } from "../sources/audiobookshelf/adapter";
import { adaptGoodreadsCsv } from "../sources/goodreads/adapter";
import { adaptGrouveeCsv } from "../sources/grouvee/adapter";
import { adaptHardcoverCsv } from "../sources/hardcover/adapter";
import { adaptIgdbCsv } from "../sources/igdb/adapter";
import { adaptImdbCsv } from "../sources/imdb/adapter";
import { adaptJellyfinData } from "../sources/jellyfin/adapter";
import { adaptMediaTrackerData } from "../sources/media-tracker/adapter";
import { loadMovaryAdapterResult } from "../sources/movary/processor";
import { loadMyanimelistAdapterResult } from "../sources/myanimelist/processor";
import { loadNetflixAdapterResult } from "../sources/netflix/processor";
import { adaptPlexData } from "../sources/plex/adapter";
import {
	getOptionalSourcePayloadBoolean,
	getOptionalSourcePayloadString,
	getRequiredSourcePayloadString,
} from "../sources/shared/source-payload";
import { adaptStorygraphCsv } from "../sources/storygraph/adapter";
import { adaptTraktData } from "../sources/trakt/adapter";
import { adaptWatcharrExport } from "../sources/watcharr/adapter";
import { MediaImportAdapterResultSchema } from "./adapter-result";
import {
	loadMediaTextFileAdapterResult,
	type LoadedMediaImportAdapterError,
	type LoadedMediaImportAdapterResult,
} from "./file-processor";

type MediaImportLoadInput = Pick<ImportRunJobData, "runId" | "source" | "userId"> & {
	filePath?: string;
	sourcePayload?: Record<string, unknown>;
};

type MediaImportLoadRequirements =
	| DbRunner
	| AppConfig
	| Path.Path
	| RedisService
	| EntitiesRepository
	| HttpClient.HttpClient
	| FileSystem.FileSystem;

const SearchScriptSlugSchema = Schema.Literal("movie.tmdb", "show.tmdb");

const MediaImportEntitySearchJob = Schema.Struct({
	query: Schema.String,
	jobKey: Schema.String,
	scriptId: SandboxScriptId,
	scriptSlug: SearchScriptSlugSchema,
});

const LoadedMediaImportAdapterLoaded = Schema.TaggedStruct("loaded", {
	cleanupPaths: Schema.Array(Schema.String),
	adapterResult: MediaImportAdapterResultSchema,
});

export const LoadedMediaImportAdapterNetflixSearchPlanned = Schema.TaggedStruct(
	"netflix-search-planned",
	{
		importedAt: Schema.String,
		myListPath: Schema.String,
		ratingsPath: Schema.String,
		viewingActivityPath: Schema.String,
		cleanupPaths: Schema.Array(Schema.String),
		profileName: Schema.optional(Schema.String),
		searchJobs: Schema.Array(MediaImportEntitySearchJob),
	},
);

export const LoadedMediaImportAdapterSuccess = Schema.Union(
	LoadedMediaImportAdapterLoaded,
	LoadedMediaImportAdapterNetflixSearchPlanned,
);

export type LoadedMediaImportAdapterSuccess = typeof LoadedMediaImportAdapterSuccess.Type;

const asLoadedMediaImportAdapterSuccess = (
	input: LoadedMediaImportAdapterResult,
): LoadedMediaImportAdapterSuccess => ({
	_tag: "loaded",
	adapterResult: input.adapterResult,
	cleanupPaths: [...input.cleanupPaths],
});

const noCleanup = <R>(
	effect: Effect.Effect<LoadedMediaImportAdapterResult["adapterResult"], unknown, R>,
): Effect.Effect<LoadedMediaImportAdapterSuccess, unknown, R> =>
	effect.pipe(
		Effect.map((adapterResult) =>
			asLoadedMediaImportAdapterSuccess({ adapterResult, cleanupPaths: [] as const }),
		),
	);

const validateImportJobFilePath = Effect.fn("validateImportJobFilePath")(function* (
	filePath: string,
) {
	const config = yield* AppConfig;
	const safePath = yield* resolveSafeImportFilePath(filePath, config.tmpDir).pipe(
		Effect.mapError(
			() =>
				({
					cleanupPaths: [],
					message: "Import job has an invalid file path",
				}) satisfies LoadedMediaImportAdapterError,
		),
	);
	yield* validateFileExtension(safePath, getKnownImportExtensions()).pipe(
		Effect.mapError(
			() =>
				({
					cleanupPaths: [safePath],
					message: "Import job has an invalid file extension",
				}) satisfies LoadedMediaImportAdapterError,
		),
	);
	return safePath;
});

const withLoadFallback = <R>(
	fallback: string,
	effect: Effect.Effect<LoadedMediaImportAdapterSuccess, unknown, R>,
) =>
	effect.pipe(
		Effect.mapError((error) => {
			if (
				typeof error === "object" &&
				error !== null &&
				"message" in error &&
				"cleanupPaths" in error
			) {
				return {
					message: typeof error.message === "string" ? error.message : fallback,
					cleanupPaths: Array.isArray(error.cleanupPaths) ? error.cleanupPaths : [],
				} satisfies LoadedMediaImportAdapterError;
			}

			return {
				cleanupPaths: [],
				message: typeof error === "string" ? error : sanitizeErrorMessage(error, fallback),
			} satisfies LoadedMediaImportAdapterError;
		}),
	);

const oneTimeMediaImportSourceLoaders: Partial<
	Record<
		ImportRunJobData["source"],
		(
			input: MediaImportLoadInput,
		) => Effect.Effect<
			LoadedMediaImportAdapterSuccess,
			LoadedMediaImportAdapterError,
			MediaImportLoadRequirements
		>
	>
> = {
	imdb: (input) =>
		withLoadFallback(
			"Could not parse IMDb import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "IMDb",
				loadAdapterResult: adaptImdbCsv,
			}).pipe(Effect.map(asLoadedMediaImportAdapterSuccess)),
		),
	igdb: (input) =>
		withLoadFallback(
			"Could not parse IGDB import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "IGDB",
				loadAdapterResult: (fileText) => {
					const collection = input.sourcePayload?.collection;
					if (typeof collection !== "string" || collection.trim().length === 0) {
						throw new Error("Import job is missing IGDB collection");
					}
					return adaptIgdbCsv(fileText, { collection: collection.trim() });
				},
			}).pipe(Effect.map(asLoadedMediaImportAdapterSuccess)),
		),
	anilist: (input) =>
		withLoadFallback(
			"Could not parse Anilist import data",
			Effect.gen(function* () {
				const config = yield* AppConfig;
				return yield* loadMediaTextFileAdapterResult({
					...input,
					sourceName: "Anilist",
					loadAdapterResult: (fileText) => adaptAnilistExport(fileText, config.timezone),
				}).pipe(Effect.map(asLoadedMediaImportAdapterSuccess));
			}),
		),
	grouvee: (input) =>
		withLoadFallback(
			"Could not parse Grouvee import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "Grouvee",
				loadAdapterResult: adaptGrouveeCsv,
			}).pipe(Effect.map(asLoadedMediaImportAdapterSuccess)),
		),
	watcharr: (input) =>
		withLoadFallback(
			"Could not parse Watcharr import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "Watcharr",
				loadAdapterResult: adaptWatcharrExport,
			}).pipe(Effect.map(asLoadedMediaImportAdapterSuccess)),
		),
	hardcover: (input) =>
		withLoadFallback(
			"Could not parse Hardcover import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "Hardcover",
				loadAdapterResult: adaptHardcoverCsv,
			}).pipe(Effect.map(asLoadedMediaImportAdapterSuccess)),
		),
	goodreads: (input) =>
		withLoadFallback(
			"Could not parse Goodreads import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "Goodreads",
				loadAdapterResult: adaptGoodreadsCsv,
			}).pipe(Effect.map(asLoadedMediaImportAdapterSuccess)),
		),
	storygraph: (input) =>
		withLoadFallback(
			"Could not parse StoryGraph import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "StoryGraph",
				loadAdapterResult: adaptStorygraphCsv,
			}).pipe(Effect.map(asLoadedMediaImportAdapterSuccess)),
		),
	movary: (input) =>
		withLoadFallback(
			"Could not parse Movary export data",
			loadMovaryAdapterResult(input).pipe(Effect.map(asLoadedMediaImportAdapterSuccess)),
		),
	netflix: (input) =>
		withLoadFallback("Could not parse Netflix export data", loadNetflixAdapterResult(input)),
	myanimelist: (input) =>
		withLoadFallback(
			"Could not parse MyAnimeList export data",
			loadMyanimelistAdapterResult(input).pipe(Effect.map(asLoadedMediaImportAdapterSuccess)),
		),
	trakt: (input) =>
		withLoadFallback(
			"Failed to fetch data from Trakt",
			noCleanup(
				Effect.gen(function* () {
					const config = yield* AppConfig;
					const clientId = makeImporterConfig(config).trakt.clientId;
					const username = getRequiredSourcePayloadString(input.sourcePayload, "username");
					if (!username) {
						return yield* Effect.fail("Import job is missing Trakt username");
					}
					if (!clientId) {
						return yield* Effect.fail(
							"Trakt importer is not configured. Set SERVER_IMPORTER_TRAKT_CLIENT_ID.",
						);
					}
					return yield* adaptTraktData(username, clientId);
				}),
			),
		),
	plex: (input) =>
		withLoadFallback(
			"Failed to fetch data from Plex",
			noCleanup(
				Effect.gen(function* () {
					const apiKey = getRequiredSourcePayloadString(input.sourcePayload, "apiKey");
					const apiUrl = getRequiredSourcePayloadString(input.sourcePayload, "apiUrl");
					const allowInsecureConnections = getOptionalSourcePayloadBoolean(
						input.sourcePayload,
						"allowInsecureConnections",
					);
					if (!apiKey || !apiUrl) {
						return yield* Effect.fail("Import job is missing Plex credentials");
					}
					return yield* adaptPlexData({ apiKey, apiUrl, allowInsecureConnections });
				}),
			),
		),
	media_tracker: (input) =>
		withLoadFallback(
			"Failed to fetch data from MediaTracker",
			noCleanup(
				Effect.gen(function* () {
					const apiKey = getRequiredSourcePayloadString(input.sourcePayload, "apiKey");
					const apiUrl = getRequiredSourcePayloadString(input.sourcePayload, "apiUrl");
					const allowInsecureConnections = getOptionalSourcePayloadBoolean(
						input.sourcePayload,
						"allowInsecureConnections",
					);
					if (!apiKey || !apiUrl) {
						return yield* Effect.fail("Import job is missing MediaTracker credentials");
					}
					return yield* adaptMediaTrackerData({ apiKey, apiUrl, allowInsecureConnections });
				}),
			),
		),
	audiobookshelf: (input) =>
		withLoadFallback(
			"Failed to fetch data from Audiobookshelf",
			noCleanup(
				Effect.gen(function* () {
					const apiKey = getRequiredSourcePayloadString(input.sourcePayload, "apiKey");
					const apiUrl = getRequiredSourcePayloadString(input.sourcePayload, "apiUrl");
					const allowInsecureConnections = getOptionalSourcePayloadBoolean(
						input.sourcePayload,
						"allowInsecureConnections",
					);
					if (!apiKey || !apiUrl) {
						return yield* Effect.fail("Import job is missing Audiobookshelf credentials");
					}
					return yield* adaptAudiobookshelfData({ apiKey, apiUrl, allowInsecureConnections });
				}),
			),
		),
	jellyfin: (input) =>
		withLoadFallback(
			"Failed to fetch data from Jellyfin",
			noCleanup(
				Effect.gen(function* () {
					const apiUrl = getRequiredSourcePayloadString(input.sourcePayload, "apiUrl");
					const username = getRequiredSourcePayloadString(input.sourcePayload, "username");
					const password = getOptionalSourcePayloadString(input.sourcePayload, "password");
					const allowInsecureConnections = getOptionalSourcePayloadBoolean(
						input.sourcePayload,
						"allowInsecureConnections",
					);
					if (!apiUrl || !username) {
						return yield* Effect.fail("Import job is missing Jellyfin connection details");
					}
					return yield* adaptJellyfinData({
						apiUrl,
						username,
						password,
						allowInsecureConnections,
					});
				}),
			),
		),
};

export const isOneTimeMediaImportSource = (source: string): boolean =>
	source in oneTimeMediaImportSourceLoaders;

export const loadOneTimeMediaImportAdapterResult = Effect.fn(
	"imports.loadOneTimeMediaImportAdapterResult",
)(function* (payload: ImportRunJobData) {
	const loader = oneTimeMediaImportSourceLoaders[payload.source];
	if (!loader) {
		return yield* Effect.fail({
			message: `Unsupported import source: ${payload.source}`,
			cleanupPaths: [],
		} satisfies LoadedMediaImportAdapterError);
	}

	const sourcePayload = payload.sourcePayloadKey
		? ((yield* loadImportSourcePayload(payload.sourcePayloadKey)) ?? undefined)
		: payload.sourcePayload;
	const filePath = payload.filePath
		? yield* validateImportJobFilePath(payload.filePath)
		: undefined;

	return yield* loader({
		filePath,
		sourcePayload,
		runId: payload.runId,
		source: payload.source,
		userId: payload.userId,
	});
});
