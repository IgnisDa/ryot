import { type Job, WaitingChildrenError } from "bullmq";

import { getTemporaryDirectory } from "~/lib/bun";

import { cleanupImportFile, resolveSafeImportFilePath, validateFileExtension } from "./files";
import type { ImportEntityRef, ImportMediaEntityGroup, ImportRunJobData } from "./jobs";
import { getImportRunById, updateImportRun } from "./repository";
import type { ImportRunSource } from "./schemas";
import { getKnownImportExtensions } from "./source-config";
import { processGoodreadsImport } from "./sources/goodreads/processor";
import { processHardcoverImport } from "./sources/hardcover/processor";
import { processHevyImport } from "./sources/hevy/processor";
import { processOpenScaleImport } from "./sources/open-scale/processor";
import { processStorygraphImport } from "./sources/storygraph/processor";
import { processStrongAppImport } from "./sources/strong-app/processor";
import { processTraktImport } from "./sources/trakt/processor";

const sanitizeErrorMessage = (error: unknown, fallback: string): string => {
	if (!(error instanceof Error)) {
		return fallback;
	}
	return error.message;
};

type ProcessImportJobInput = {
	job: Job;
	runId: string;
	token?: string;
	userId: string;
	filePath?: string;
	traktUsername?: string;
	sourcePayload?: Record<string, unknown>;
	providerEntityIndex?: number;
	adapterFailureCount?: number;
	mediaWriteGroupIndex?: number;
	providerSandboxJobId?: string;
	mediaWriteFailedItems?: number;
	mediaWriteImportedItems?: number;
	providerFailedIndices?: number[];
	providerEntityRefs?: ImportEntityRef[];
	providerEntityIds?: Array<string | null>;
	importStep?: ImportRunJobData["importStep"];
	mediaEntityGroups?: ImportMediaEntityGroup[];
};

type SourceProcessorInput = Omit<ProcessImportJobInput, "filePath"> & { filePath?: string };
type FileSourceProcessorInput = SourceProcessorInput & { filePath: string };

type ImportSourceProcessorConfig =
	| {
			inputKind: "file";
			process: (input: FileSourceProcessorInput) => Promise<void>;
	  }
	| {
			inputKind: "source_payload";
			process: (input: SourceProcessorInput) => Promise<void>;
	  };

const mediaProcessorInput = (input: SourceProcessorInput) => ({
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

const importSourceProcessors: Partial<Record<ImportRunSource, ImportSourceProcessorConfig>> = {
	goodreads: {
		inputKind: "file",
		process: (input) =>
			processGoodreadsImport(input.job, input.token, {
				...mediaProcessorInput(input),
				filePath: input.filePath,
			}),
	},
	hardcover: {
		inputKind: "file",
		process: (input) =>
			processHardcoverImport(input.job, input.token, {
				...mediaProcessorInput(input),
				filePath: input.filePath,
			}),
	},
	hevy: {
		inputKind: "file",
		process: (input) =>
			processHevyImport({ runId: input.runId, userId: input.userId, filePath: input.filePath }),
	},
	open_scale: {
		inputKind: "file",
		process: (input) =>
			processOpenScaleImport({
				runId: input.runId,
				userId: input.userId,
				filePath: input.filePath,
			}),
	},
	storygraph: {
		inputKind: "file",
		process: (input) =>
			processStorygraphImport(input.job, input.token, {
				...mediaProcessorInput(input),
				filePath: input.filePath,
			}),
	},
	strong_app: {
		inputKind: "file",
		process: (input) =>
			processStrongAppImport({
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

const failImportRun = async (runId: string, errorSummary: string): Promise<void> => {
	await updateImportRun({
		runId,
		status: "failed",
		finishedAt: new Date(),
		errorSummary,
	});
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
