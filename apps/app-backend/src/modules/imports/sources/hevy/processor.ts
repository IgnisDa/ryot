import { cleanupImportFile, readImportFile } from "../../files";
import { updateImportRun } from "../../repository";
import { processWorkoutImportResult } from "../../workout/processor";
import { adaptHevyCsv } from "./adapter";

const sanitizeErrorMessage = (error: unknown, fallback: string): string => {
	if (!(error instanceof Error)) {
		return fallback;
	}
	return error.message;
};

export const processHevyImport = async (input: {
	runId: string;
	userId: string;
	filePath: string;
}): Promise<void> => {
	const safePath = input.filePath;

	try {
		let csvText: string;
		try {
			csvText = await readImportFile(safePath);
		} catch {
			await updateImportRun({
				status: "failed",
				runId: input.runId,
				finishedAt: new Date(),
				errorSummary: "Could not read import file",
			});
			return;
		}

		let adapterResult: Awaited<ReturnType<typeof adaptHevyCsv>>;
		try {
			adapterResult = adaptHevyCsv(csvText);
		} catch (error) {
			await updateImportRun({
				status: "failed",
				runId: input.runId,
				finishedAt: new Date(),
				errorSummary: sanitizeErrorMessage(error, "Could not parse Hevy CSV"),
			});
			return;
		}

		await processWorkoutImportResult({
			adapterResult,
			runId: input.runId,
			userId: input.userId,
		});
	} finally {
		await cleanupImportFile(safePath);
	}
};
