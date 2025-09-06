import type { Job } from "bullmq";

import { cleanupImportFile, readImportFile } from "../../runtime/files";
import {
	processMediaImport,
	type MediaImportAdapterResult,
	type MediaImportJobInput,
} from "../import-processor";

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
	input: MediaImportJobInput & {
		filePath: string;
		sourceName: string;
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
