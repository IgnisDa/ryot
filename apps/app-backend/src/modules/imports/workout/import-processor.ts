import { cleanupImportFile, readImportFile } from "../files";
import { updateImportRun } from "../repository";
import type { WorkoutAdapterResult } from "./domain";
import { processWorkoutImportResult } from "./processor";

export type WorkoutCsvImportProcessorDeps = {
	readImportFile: typeof readImportFile;
	updateImportRun: typeof updateImportRun;
	cleanupImportFile: typeof cleanupImportFile;
	processWorkoutImportResult: typeof processWorkoutImportResult;
};

const workoutCsvImportProcessorDeps: WorkoutCsvImportProcessorDeps = {
	readImportFile,
	updateImportRun,
	cleanupImportFile,
	processWorkoutImportResult,
};

const sanitizeErrorMessage = (error: unknown, fallback: string): string => {
	if (!(error instanceof Error)) {
		return fallback;
	}
	return error.message;
};

export const processWorkoutCsvImport = async (
	input: {
		runId: string;
		userId: string;
		filePath: string;
		sourceName: string;
		adapt: (csvText: string) => Promise<WorkoutAdapterResult> | WorkoutAdapterResult;
	},
	deps: WorkoutCsvImportProcessorDeps = workoutCsvImportProcessorDeps,
): Promise<void> => {
	const safePath = input.filePath;

	try {
		let csvText: string;
		try {
			csvText = await deps.readImportFile(safePath);
		} catch {
			await deps.updateImportRun({
				runId: input.runId,
				status: "failed",
				finishedAt: new Date(),
				errorSummary: "Could not read import file",
			});
			return;
		}

		let adapterResult: WorkoutAdapterResult;
		try {
			adapterResult = await input.adapt(csvText);
		} catch (error) {
			await deps.updateImportRun({
				runId: input.runId,
				status: "failed",
				finishedAt: new Date(),
				errorSummary: sanitizeErrorMessage(error, `Could not parse ${input.sourceName} CSV`),
			});
			return;
		}

		await deps.processWorkoutImportResult({
			adapterResult,
			runId: input.runId,
			userId: input.userId,
		});
	} finally {
		await deps.cleanupImportFile(safePath);
	}
};
