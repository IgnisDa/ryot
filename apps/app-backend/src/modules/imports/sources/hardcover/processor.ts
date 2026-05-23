import type { Job } from "bullmq";

import type { ImportEntityRef, ImportMediaEntityGroup, ImportRunJobData } from "../../jobs";
import { processBookCsvImport } from "../book/processor";
import { adaptHardcoverCsv } from "./adapter";

export const processHardcoverImport = async (
	job: Job,
	token: string | undefined,
	input: {
		runId: string;
		userId: string;
		filePath: string;
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
	},
): Promise<void> =>
	processBookCsvImport(job, token, { ...input, sourceName: "Hardcover", adapt: adaptHardcoverCsv });
