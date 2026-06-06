import type { FileSystem, HttpClient, Path } from "@effect/platform";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect } from "effect";

import { AppConfig } from "~/lib/config";
import type { DbRunner } from "~/lib/db";
import type { RedisService } from "~/lib/redis";
import type { EntitiesRepository } from "~/modules/entities/repository";

import type { ImportRunJobData } from "../jobs";
import { sanitizeErrorMessage } from "../runtime/failures";
import {
	getTemporaryDirectory,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "../runtime/files";
import { importerConfig } from "../runtime/importer-config";
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
	| WorkflowEngine
	| EntitiesRepository
	| HttpClient.HttpClient
	| FileSystem.FileSystem;

const noCleanup = <R>(
	effect: Effect.Effect<LoadedMediaImportAdapterResult["adapterResult"], unknown, R>,
): Effect.Effect<LoadedMediaImportAdapterResult, unknown, R> =>
	effect.pipe(Effect.map((adapterResult) => ({ adapterResult, cleanupPaths: [] as const })));

const validateImportJobFilePath = (filePath: string) => {
	const safePathResult = resolveSafeImportFilePath(filePath, getTemporaryDirectory());
	if ("error" in safePathResult) {
		return Effect.fail({
			cleanupPaths: [],
			message: "Import job has an invalid file path",
		} satisfies LoadedMediaImportAdapterError);
	}

	const extResult = validateFileExtension(safePathResult.path, getKnownImportExtensions());
	if ("error" in extResult) {
		return Effect.fail({
			cleanupPaths: [safePathResult.path],
			message: "Import job has an invalid file extension",
		} satisfies LoadedMediaImportAdapterError);
	}

	return Effect.succeed(safePathResult.path);
};

const withLoadFallback = <R>(
	fallback: string,
	effect: Effect.Effect<LoadedMediaImportAdapterResult, unknown, R>,
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
			LoadedMediaImportAdapterResult,
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
			}),
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
			}),
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
				});
			}),
		),
	grouvee: (input) =>
		withLoadFallback(
			"Could not parse Grouvee import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "Grouvee",
				loadAdapterResult: adaptGrouveeCsv,
			}),
		),
	watcharr: (input) =>
		withLoadFallback(
			"Could not parse Watcharr import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "Watcharr",
				loadAdapterResult: adaptWatcharrExport,
			}),
		),
	hardcover: (input) =>
		withLoadFallback(
			"Could not parse Hardcover import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "Hardcover",
				loadAdapterResult: adaptHardcoverCsv,
			}),
		),
	goodreads: (input) =>
		withLoadFallback(
			"Could not parse Goodreads import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "Goodreads",
				loadAdapterResult: adaptGoodreadsCsv,
			}),
		),
	storygraph: (input) =>
		withLoadFallback(
			"Could not parse StoryGraph import data",
			loadMediaTextFileAdapterResult({
				...input,
				sourceName: "StoryGraph",
				loadAdapterResult: adaptStorygraphCsv,
			}),
		),
	movary: (input) =>
		withLoadFallback("Could not parse Movary export data", loadMovaryAdapterResult(input)),
	netflix: (input) =>
		withLoadFallback("Could not parse Netflix export data", loadNetflixAdapterResult(input)),
	myanimelist: (input) =>
		withLoadFallback(
			"Could not parse MyAnimeList export data",
			loadMyanimelistAdapterResult(input),
		),
	trakt: (input) =>
		withLoadFallback(
			"Failed to fetch data from Trakt",
			noCleanup(
				Effect.gen(function* () {
					const username = getRequiredSourcePayloadString(input.sourcePayload, "username");
					const clientId = importerConfig.trakt.clientId;
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

export const loadOneTimeMediaImportAdapterResult = (payload: ImportRunJobData) =>
	Effect.gen(function* () {
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
