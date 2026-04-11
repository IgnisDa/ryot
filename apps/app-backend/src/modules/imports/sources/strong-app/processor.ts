import { processWorkoutCsvImport } from "../../workout/import-processor";
import { adaptStrongAppCsv } from "./adapter";

export const processStrongAppImport = async (input: {
	runId: string;
	userId: string;
	filePath: string;
}): Promise<void> =>
	processWorkoutCsvImport({
		...input,
		sourceName: "StrongApp",
		adapt: adaptStrongAppCsv,
	});
