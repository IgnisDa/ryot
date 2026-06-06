import type { Job } from "bullmq";

import type { ImportRunJobData } from "../jobs";
import { processOpenScaleImport } from "../measurement/processor";
import { processBookCsvImport } from "../media/book/processor";
import { processMediaTextFileImport } from "../media/file-processor";
import type { MediaImportAdapterResult, MediaImportJobInput } from "../media/import-processor";
import type { ImportRunSource } from "../schemas";
import { adaptAnilistExport } from "../sources/anilist/adapter";
import { processAudiobookshelfImport } from "../sources/audiobookshelf/processor";
import { adaptGoodreadsCsv } from "../sources/goodreads/adapter";
import { adaptGrouveeCsv } from "../sources/grouvee/adapter";
import { adaptHardcoverCsv } from "../sources/hardcover/adapter";
import { adaptHevyCsv } from "../sources/hevy/adapter";
import { adaptIgdbCsv } from "../sources/igdb/adapter";
import { adaptImdbCsv } from "../sources/imdb/adapter";
import { processJellyfinImport } from "../sources/jellyfin/processor";
import { processMediatrackerImport } from "../sources/mediatracker/processor";
import { processMyanimelistImport } from "../sources/myanimelist/processor";
import { processPlexImport } from "../sources/plex/processor";
import { adaptStorygraphCsv } from "../sources/storygraph/adapter";
import { adaptStrongAppCsv } from "../sources/strong-app/adapter";
import { processTraktImport } from "../sources/trakt/processor";
import { adaptWatcharrExport } from "../sources/watcharr/adapter";
import type { WorkoutAdapterResult } from "../workout/domain";
import { processWorkoutCsvImport } from "../workout/import-processor";

export type SourceProcessorInput = ImportRunJobData & {
	job: Job;
	token?: string;
};

type FileSourceProcessorInput = SourceProcessorInput & { filePath?: string };
type BookCsvAdapter = (
	csvText: string,
) => Promise<MediaImportAdapterResult> | MediaImportAdapterResult;
type WorkoutCsvAdapter = (csvText: string) => Promise<WorkoutAdapterResult> | WorkoutAdapterResult;

type ImportSourceProcessorConfig =
	| {
			inputKind: "file";
			process: (input: FileSourceProcessorInput) => Promise<void>;
	  }
	| {
			inputKind: "source_payload";
			process: (input: SourceProcessorInput) => Promise<void>;
	  };

const mediaProcessorInput = (input: SourceProcessorInput): MediaImportJobInput => ({
	runId: input.runId,
	userId: input.userId,
	importStep: input.importStep,
	providerEntityIds: input.providerEntityIds,
	mediaEntityGroups: input.mediaEntityGroups,
	providerEntityRefs: input.providerEntityRefs,
	resolveEntityIndex: input.resolveEntityIndex,
	adapterFailureCount: input.adapterFailureCount,
	resolveSandboxJobId: input.resolveSandboxJobId,
	providerEntityIndex: input.providerEntityIndex,
	providerSandboxJobId: input.providerSandboxJobId,
	resolveFailedIndices: input.resolveFailedIndices,
	mediaWriteGroupIndex: input.mediaWriteGroupIndex,
	providerFailedIndices: input.providerFailedIndices,
	resolveCandidateIndex: input.resolveCandidateIndex,
	mediaWriteFailedItems: input.mediaWriteFailedItems,
	mediaWriteImportedItems: input.mediaWriteImportedItems,
});

const sourcePayloadInput = (input: SourceProcessorInput) => {
	if (input.sourcePayload) {
		return input.sourcePayload;
	}
	const username = input.traktUsername?.trim();
	return username ? { username } : undefined;
};

const requireFilePath = (input: FileSourceProcessorInput): string => {
	if (!input.filePath) {
		throw new Error("Import job is missing file path");
	}
	return input.filePath;
};

const mediaTextFileProcessor = (
	sourceName: string,
	adapt: (fileText: string) => Promise<MediaImportAdapterResult> | MediaImportAdapterResult,
): ImportSourceProcessorConfig => ({
	inputKind: "file",
	process: (input) =>
		processMediaTextFileImport(input.job, input.token, {
			...mediaProcessorInput(input),
			sourceName,
			filePath: input.filePath,
			loadAdapterResult: (fileText) => adapt(fileText),
		}),
});

const bookCsvProcessor = (
	sourceName: string,
	adapt: BookCsvAdapter,
): ImportSourceProcessorConfig => ({
	inputKind: "file",
	process: (input) =>
		processBookCsvImport(input.job, input.token, {
			...mediaProcessorInput(input),
			adapt,
			sourceName,
			filePath: input.filePath,
		}),
});

const workoutCsvProcessor = (
	sourceName: string,
	adapt: WorkoutCsvAdapter,
): ImportSourceProcessorConfig => ({
	inputKind: "file",
	process: (input) =>
		processWorkoutCsvImport({
			adapt,
			sourceName,
			runId: input.runId,
			userId: input.userId,
			filePath: requireFilePath(input),
		}),
});

const importSourceProcessors: Partial<Record<ImportRunSource, ImportSourceProcessorConfig>> = {
	hevy: workoutCsvProcessor("Hevy", adaptHevyCsv),
	imdb: mediaTextFileProcessor("IMDb", adaptImdbCsv),
	grouvee: mediaTextFileProcessor("Grouvee", adaptGrouveeCsv),
	goodreads: bookCsvProcessor("Goodreads", adaptGoodreadsCsv),
	hardcover: bookCsvProcessor("Hardcover", adaptHardcoverCsv),
	anilist: mediaTextFileProcessor("Anilist", adaptAnilistExport),
	storygraph: bookCsvProcessor("StoryGraph", adaptStorygraphCsv),
	strong_app: workoutCsvProcessor("StrongApp", adaptStrongAppCsv),
	watcharr: mediaTextFileProcessor("Watcharr", adaptWatcharrExport),
	myanimelist: {
		inputKind: "file",
		process: (input) =>
			processMyanimelistImport(input.job, input.token, {
				...mediaProcessorInput(input),
				filePath: input.filePath,
				sourcePayload: input.sourcePayload,
			}),
	},
	trakt: {
		inputKind: "source_payload",
		process: (input) =>
			processTraktImport(input.job, input.token, {
				...mediaProcessorInput(input),
				sourcePayload: sourcePayloadInput(input),
			}),
	},
	plex: {
		inputKind: "source_payload",
		process: (input) =>
			processPlexImport(input.job, input.token, {
				...mediaProcessorInput(input),
				sourcePayload: sourcePayloadInput(input),
			}),
	},
	jellyfin: {
		inputKind: "source_payload",
		process: (input) =>
			processJellyfinImport(input.job, input.token, {
				...mediaProcessorInput(input),
				sourcePayload: sourcePayloadInput(input),
			}),
	},
	mediatracker: {
		inputKind: "source_payload",
		process: (input) =>
			processMediatrackerImport(input.job, input.token, {
				...mediaProcessorInput(input),
				sourcePayload: sourcePayloadInput(input),
			}),
	},
	audiobookshelf: {
		inputKind: "source_payload",
		process: (input) =>
			processAudiobookshelfImport(input.job, input.token, {
				...mediaProcessorInput(input),
				sourcePayload: sourcePayloadInput(input),
			}),
	},
	open_scale: {
		inputKind: "file",
		process: (input) =>
			processOpenScaleImport({
				runId: input.runId,
				userId: input.userId,
				filePath: requireFilePath(input),
			}),
	},
	igdb: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport(input.job, input.token, {
				...mediaProcessorInput(input),
				sourceName: "IGDB",
				filePath: input.filePath,
				loadAdapterResult: (fileText) => {
					const collection = input.sourcePayload?.collection;
					if (typeof collection !== "string" || collection.trim().length === 0) {
						throw new Error("Import job is missing IGDB collection");
					}
					return adaptIgdbCsv(fileText, { collection: collection.trim() });
				},
			}),
	},
};

export const getImportSourceProcessor = (source: ImportRunSource) => importSourceProcessors[source];
