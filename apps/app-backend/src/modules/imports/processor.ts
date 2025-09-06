import { type Job, WaitingChildrenError } from "bullmq";

import { getTemporaryDirectory } from "~/lib/bun";

import { cleanupImportFile, resolveSafeImportFilePath, validateFileExtension } from "./files";
import { failImportRun, sanitizeErrorMessage } from "./helpers";
import type { ImportRunJobData } from "./jobs";
import type { MediaImportAdapterResult, MediaImportJobInput } from "./media/import-processor";
import { getImportRunById, updateImportRun } from "./repository";
import type { ImportRunSource } from "./schemas";
import { getKnownImportExtensions } from "./source-config";
import { processBookCsvImport } from "./sources/book/processor";
import { adaptGoodreadsCsv } from "./sources/goodreads/adapter";
import { adaptHardcoverCsv } from "./sources/hardcover/adapter";
import { adaptHevyCsv } from "./sources/hevy/adapter";
import { processOpenScaleImport } from "./sources/open-scale/processor";
import { adaptStorygraphCsv } from "./sources/storygraph/adapter";
import { adaptStrongAppCsv } from "./sources/strong-app/adapter";
import { processTraktImport } from "./sources/trakt/processor";
import type { WorkoutAdapterResult } from "./workout/domain";
import { processWorkoutCsvImport } from "./workout/import-processor";

type ProcessImportJobInput = ImportRunJobData & {
	job: Job;
	token?: string;
};

type SourceProcessorInput = ProcessImportJobInput;
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
	providerEntityRefs: input.providerEntityRefs,
	adapterFailureCount: input.adapterFailureCount,
	mediaEntityGroups: input.mediaEntityGroups,
	providerEntityIndex: input.providerEntityIndex,
	providerSandboxJobId: input.providerSandboxJobId,
	mediaWriteGroupIndex: input.mediaWriteGroupIndex,
	providerFailedIndices: input.providerFailedIndices,
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

const resolveImportJobFilePath = async (input: {
	runId: string;
	filePath: string | undefined;
}): Promise<string> => {
	const tempDir = getTemporaryDirectory();
	const safePathResult = resolveSafeImportFilePath(input.filePath ?? "", tempDir);
	if ("error" in safePathResult) {
		await failImportRun(input.runId, "Import job has an invalid file path");
		throw new Error("Import job has an invalid file path");
	}

	const safePath = safePathResult.path;
	const extResult = validateFileExtension(safePath, getKnownImportExtensions());
	if ("error" in extResult) {
		await cleanupImportFile(safePath);
		await failImportRun(input.runId, "Import job has an invalid file extension");
		throw new Error("Import job has an invalid file extension");
	}

	return safePath;
};

const processWithFailureHandling = async (
	runId: string,
	process: () => Promise<void>,
): Promise<void> => {
	try {
		await process();
	} catch (error) {
		if (error instanceof WaitingChildrenError) {
			throw error;
		}
		const message = sanitizeErrorMessage(error, "Import job failed unexpectedly");
		try {
			await failImportRun(runId, message);
		} catch {
			// best effort
		}
		throw error;
	}
};

export const processImportJob = async (input: ProcessImportJobInput): Promise<void> => {
	const { runId, userId } = input;

	const run = await getImportRunById({ runId, userId });
	if (!run) {
		throw new Error(`Import run '${runId}' not found`);
	}

	if (!input.importStep) {
		await updateImportRun({ status: "running", runId, startedAt: new Date() });
	}

	const sourceProcessor = importSourceProcessors[run.source];
	if (!sourceProcessor) {
		await failImportRun(runId, `Unsupported import source: ${run.source}`);
		return;
	}

	if (sourceProcessor.inputKind === "file") {
		const safePath = await resolveImportJobFilePath({ runId, filePath: input.filePath });
		await processWithFailureHandling(runId, () =>
			sourceProcessor.process({ ...input, filePath: safePath }),
		);
		return;
	}

	await processWithFailureHandling(runId, () => sourceProcessor.process(input));
};
