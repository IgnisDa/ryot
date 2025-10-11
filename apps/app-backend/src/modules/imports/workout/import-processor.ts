import { cleanupImportFile, readImportFile } from "../files";
import { failImportRun, sanitizeErrorMessage } from "../helpers";
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
			await failImportRun(input.runId, "Could not read import file", deps.updateImportRun);
			return;
		}

		let adapterResult: WorkoutAdapterResult;
		try {
			adapterResult = await input.adapt(csvText);
		} catch (error) {
			await failImportRun(
				input.runId,
				sanitizeErrorMessage(error, `Could not parse ${input.sourceName} CSV`),
				deps.updateImportRun,
			);
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
