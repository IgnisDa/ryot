import { processWorkoutCsvImport } from "../../workout/import-processor";
import { adaptHevyCsv } from "./adapter";

export const processHevyImport = async (input: {
	runId: string;
	userId: string;
	filePath: string;
}): Promise<void> =>
	processWorkoutCsvImport({
		...input,
		sourceName: "Hevy",
		adapt: adaptHevyCsv,
	});
