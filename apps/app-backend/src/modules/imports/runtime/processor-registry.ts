import type { FileSystem, HttpClient, Path } from "@effect/platform";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect } from "effect";

import { AppConfig } from "~/lib/config";
import type { DbRunner } from "~/lib/db";
import type { DbError } from "~/lib/errors";
import type { CollectionsService } from "~/modules/collections/service";
import type { EntitiesRepository } from "~/modules/entities/repository";
import type { EntitiesService } from "~/modules/entities/service";
import type { EntitySchemasRepository } from "~/modules/entity-schemas/repository";
import type { EventSchemasRepository } from "~/modules/event-schemas/repository";
import type { EventsService } from "~/modules/events/service";
import type { RelationshipSchemasRepository } from "~/modules/relationship-schemas/repository";

import { processOpenScaleImport } from "../measurement/processor";
import { processMediaTextFileImport } from "../media/file-processor";
import type { ImportsRepository } from "../repository";
import { adaptAnilistExport } from "../sources/anilist/adapter";
import { processAudiobookshelfImport } from "../sources/audiobookshelf/processor";
import { adaptGoodreadsCsv } from "../sources/goodreads/adapter";
import { adaptGrouveeCsv } from "../sources/grouvee/adapter";
import { adaptHardcoverCsv } from "../sources/hardcover/adapter";
import { adaptHevyCsv } from "../sources/hevy/adapter";
import { adaptIgdbCsv } from "../sources/igdb/adapter";
import { adaptImdbCsv } from "../sources/imdb/adapter";
import { processJellyfinImport } from "../sources/jellyfin/processor";
import { processMediaTrackerImport } from "../sources/media-tracker/processor";
import { processMovaryImport } from "../sources/movary/processor";
import { processMyanimelistImport } from "../sources/myanimelist/processor";
import { processNetflixImport } from "../sources/netflix/processor";
import { processPlexImport } from "../sources/plex/processor";
import { adaptStorygraphCsv } from "../sources/storygraph/adapter";
import { adaptStrongAppCsv } from "../sources/strong-app/adapter";
import { processTraktImport } from "../sources/trakt/processor";
import { adaptWatcharrExport } from "../sources/watcharr/adapter";
import { processWorkoutCsvImport } from "../workout/import-processor";

type SourcePayloadProcessorInput = {
	runId: string;
	userId: string;
	sourcePayload?: Record<string, unknown>;
};

type FileSourceProcessorInput = SourcePayloadProcessorInput & { filePath: string };

type ImportProcessRequirements =
	| DbRunner
	| Path.Path
	| AppConfig
	| EventsService
	| WorkflowEngine
	| EntitiesService
	| ImportsRepository
	| CollectionsService
	| EntitiesRepository
	| HttpClient.HttpClient
	| FileSystem.FileSystem
	| EventSchemasRepository
	| EntitySchemasRepository
	| RelationshipSchemasRepository;

type ImportSourceProcessorConfig =
	| {
			inputKind: "file";
			process: (
				input: FileSourceProcessorInput,
			) => Effect.Effect<void, DbError, ImportProcessRequirements>;
	  }
	| {
			inputKind: "source_payload";
			process: (
				input: SourcePayloadProcessorInput,
			) => Effect.Effect<void, DbError, ImportProcessRequirements>;
	  };

const importSourceProcessors: Partial<Record<string, ImportSourceProcessorConfig>> = {
	movary: { inputKind: "file", process: (input) => processMovaryImport(input) },
	netflix: { inputKind: "file", process: (input) => processNetflixImport(input) },
	plex: { inputKind: "source_payload", process: (input) => processPlexImport(input) },
	open_scale: { inputKind: "file", process: (input) => processOpenScaleImport(input) },
	trakt: { inputKind: "source_payload", process: (input) => processTraktImport(input) },
	myanimelist: { inputKind: "file", process: (input) => processMyanimelistImport(input) },
	jellyfin: { inputKind: "source_payload", process: (input) => processJellyfinImport(input) },
	media_tracker: {
		inputKind: "source_payload",
		process: (input) => processMediaTrackerImport(input),
	},
	audiobookshelf: {
		inputKind: "source_payload",
		process: (input) => processAudiobookshelfImport(input),
	},
	hevy: {
		inputKind: "file",
		process: (input) =>
			processWorkoutCsvImport({ ...input, sourceName: "Hevy", adapt: adaptHevyCsv }),
	},
	strong_app: {
		inputKind: "file",
		process: (input) =>
			processWorkoutCsvImport({ ...input, sourceName: "StrongApp", adapt: adaptStrongAppCsv }),
	},
	imdb: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({ ...input, sourceName: "IMDb", loadAdapterResult: adaptImdbCsv }),
	},
	igdb: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
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
	},
	anilist: {
		inputKind: "file",
		process: (input) =>
			Effect.gen(function* () {
				const config = yield* AppConfig;
				return yield* processMediaTextFileImport({
					...input,
					sourceName: "Anilist",
					loadAdapterResult: (fileText) => adaptAnilistExport(fileText, config.timezone),
				});
			}),
	},
	grouvee: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
				...input,
				sourceName: "Grouvee",
				loadAdapterResult: adaptGrouveeCsv,
			}),
	},
	watcharr: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
				...input,
				sourceName: "Watcharr",
				loadAdapterResult: adaptWatcharrExport,
			}),
	},
	hardcover: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
				...input,
				sourceName: "Hardcover",
				loadAdapterResult: adaptHardcoverCsv,
			}),
	},
	goodreads: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
				...input,
				sourceName: "Goodreads",
				loadAdapterResult: adaptGoodreadsCsv,
			}),
	},
	storygraph: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
				...input,
				sourceName: "StoryGraph",
				loadAdapterResult: adaptStorygraphCsv,
			}),
	},
};

export const getImportSourceProcessor = (source: string): ImportSourceProcessorConfig | undefined =>
	importSourceProcessors[source];
