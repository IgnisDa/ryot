import type { Job } from "bullmq";

import type { ImportRunJobData } from "../jobs";
import { processOpenScaleImport } from "../measurement/processor";
import { processBookCsvImport } from "../media/book/processor";
import type { MediaImportAdapterResult, MediaImportJobInput } from "../media/import-processor";
import type { ImportRunSource } from "../schemas";
import { adaptGoodreadsCsv } from "../sources/goodreads/adapter";
import { adaptHardcoverCsv } from "../sources/hardcover/adapter";
import { adaptHevyCsv } from "../sources/hevy/adapter";
import { adaptStorygraphCsv } from "../sources/storygraph/adapter";
import { adaptStrongAppCsv } from "../sources/strong-app/adapter";
import { processTraktImport } from "../sources/trakt/processor";
import type { WorkoutAdapterResult } from "../workout/domain";
import { processWorkoutCsvImport } from "../workout/import-processor";

export type SourceProcessorInput = ImportRunJobData & {
	job: Job;
	token?: string;
};

type FileSourceProcessorInput = SourceProcessorInput & { filePath: string };
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
			filePath: input.filePath,
		}),
});

const importSourceProcessors: Partial<Record<ImportRunSource, ImportSourceProcessorConfig>> = {
	hevy: workoutCsvProcessor("Hevy", adaptHevyCsv),
	goodreads: bookCsvProcessor("Goodreads", adaptGoodreadsCsv),
	hardcover: bookCsvProcessor("Hardcover", adaptHardcoverCsv),
	storygraph: bookCsvProcessor("StoryGraph", adaptStorygraphCsv),
	strong_app: workoutCsvProcessor("StrongApp", adaptStrongAppCsv),
	open_scale: {
		inputKind: "file",
		process: (input) =>
			processOpenScaleImport({
				runId: input.runId,
				userId: input.userId,
				filePath: input.filePath,
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
};

export const getImportSourceProcessor = (source: ImportRunSource) => importSourceProcessors[source];
