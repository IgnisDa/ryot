import type { Job } from "bullmq";

import { cleanupImportFile, readImportFile } from "../../files";
import type { ImportEntityRef, ImportMediaEntityGroup, ImportRunJobData } from "../../jobs";
import { processMediaImport, type MediaImportAdapterResult } from "../../media/import-processor";

export type BookImportProcessorDeps = {
	readImportFile: typeof readImportFile;
	cleanupImportFile: typeof cleanupImportFile;
	processMediaImport: typeof processMediaImport;
};

const bookImportProcessorDeps: BookImportProcessorDeps = {
	readImportFile,
	cleanupImportFile,
	processMediaImport,
};

export const processBookCsvImport = async (
	job: Job,
	token: string | undefined,
	input: {
		runId: string;
		userId: string;
		filePath: string;
		sourceName: string;
		adapterFailureCount: number | undefined;
		providerEntityIndex: number | undefined;
		providerSandboxJobId: string | undefined;
		mediaWriteGroupIndex: number | undefined;
		mediaWriteFailedItems: number | undefined;
		importStep: ImportRunJobData["importStep"];
		mediaWriteImportedItems: number | undefined;
		providerFailedIndices: number[] | undefined;
		providerEntityRefs: ImportEntityRef[] | undefined;
		providerEntityIds: Array<string | null> | undefined;
		mediaEntityGroups: ImportMediaEntityGroup[] | undefined;
		adapt: (csvText: string) => Promise<MediaImportAdapterResult> | MediaImportAdapterResult;
	},
	deps: BookImportProcessorDeps = bookImportProcessorDeps,
): Promise<void> => {
	const { filePath } = input;

	await deps.processMediaImport(job, token, {
		...input,
		jobData: { filePath },
		cleanup: () => deps.cleanupImportFile(filePath),
		adapterErrorFallback: `Could not parse ${input.sourceName} import data`,
		loadAdapterResult: async () => {
			let csvText: string;
			try {
				csvText = await deps.readImportFile(filePath);
			} catch {
				throw new Error("Could not read import file");
			}
			return input.adapt(csvText);
		},
	});
};
