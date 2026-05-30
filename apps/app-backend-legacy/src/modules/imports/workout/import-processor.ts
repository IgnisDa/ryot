import { config } from "~/lib/config";

import { updateImportRun } from "../repository";
import { failImportRun, sanitizeErrorMessage } from "../runtime/failures";
import { cleanupImportFile, readImportFile } from "../runtime/files";
import type { WorkoutAdapterResult } from "./domain";
import { processWorkoutImportResultWithDeps, workoutImportProcessorDeps } from "./processor";

export type WorkoutCsvImportProcessorDeps = {
	readImportFile: typeof readImportFile;
	updateImportRun: typeof updateImportRun;
	cleanupImportFile: typeof cleanupImportFile;
	processWorkoutImportResult: (input: {
		runId: string;
		userId: string;
		adapterResult: WorkoutAdapterResult;
	}) => Promise<void>;
};

const workoutCsvImportProcessorDeps: WorkoutCsvImportProcessorDeps = {
	readImportFile,
	updateImportRun,
	cleanupImportFile,
	processWorkoutImportResult: (input) =>
		processWorkoutImportResultWithDeps(input, workoutImportProcessorDeps),
};

export const processWorkoutCsvImport = async (
	input: {
		runId: string;
		userId: string;
		filePath: string;
		sourceName: string;
		adapt: (
			csvText: string,
			timezone: string,
		) => Promise<WorkoutAdapterResult> | WorkoutAdapterResult;
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
			adapterResult = await input.adapt(csvText, config.timezone);
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
