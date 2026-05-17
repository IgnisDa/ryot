import type { Job } from "bullmq";

import type { ImportRunJobData } from "../jobs";
import { cleanupImportFile, readImportFile } from "../runtime/files";
import {
	processMediaImport,
	type MediaImportAdapterResult,
	type MediaImportJobInput,
} from "./import-processor";

export type MediaTextFileImportProcessorDeps = {
	readImportFile: typeof readImportFile;
	cleanupImportFile: typeof cleanupImportFile;
	processMediaImport: typeof processMediaImport;
};

const mediaTextFileImportProcessorDeps: MediaTextFileImportProcessorDeps = {
	readImportFile,
	cleanupImportFile,
	processMediaImport,
};

export const processMediaTextFileImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & {
		filePath: string;
		sourceName: string;
		cleanupPaths?: string[];
		adapterErrorFallback?: string;
		jobData?: Partial<ImportRunJobData>;
		loadAdapterResult: (
			fileText: string,
		) => Promise<MediaImportAdapterResult> | MediaImportAdapterResult;
	},
	deps: MediaTextFileImportProcessorDeps = mediaTextFileImportProcessorDeps,
): Promise<void> => {
	const cleanupPaths = input.cleanupPaths ?? [input.filePath];

	await deps.processMediaImport(job, token, {
		...input,
		jobData: input.jobData ?? { filePath: input.filePath },
		cleanup: async () => {
			for (const filePath of new Set(cleanupPaths)) {
				// oxlint-disable-next-line no-await-in-loop
				await deps.cleanupImportFile(filePath);
			}
		},
		adapterErrorFallback:
			input.adapterErrorFallback ?? `Could not parse ${input.sourceName} import data`,
		loadAdapterResult: async () => {
			let fileText: string;
			try {
				fileText = await deps.readImportFile(input.filePath);
			} catch {
				throw new Error("Could not read import file");
			}
			return input.loadAdapterResult(fileText);
		},
	});
};
