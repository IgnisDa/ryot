import type { Job } from "bullmq";

import { processMediaImport, type MediaImportJobInput } from "../../media/import-processor";
import {
	getOptionalSourcePayloadBoolean,
	getRequiredSourcePayloadString,
} from "../shared/source-payload";
import { adaptAudiobookshelfData } from "./adapter";

export type AudiobookshelfImportProcessorDeps = {
	processMediaImport: typeof processMediaImport;
	adaptAudiobookshelfData: typeof adaptAudiobookshelfData;
};

const audiobookshelfImportProcessorDeps: AudiobookshelfImportProcessorDeps = {
	processMediaImport,
	adaptAudiobookshelfData,
};

export const processAudiobookshelfImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & { sourcePayload: Record<string, unknown> | undefined },
	deps: AudiobookshelfImportProcessorDeps = audiobookshelfImportProcessorDeps,
): Promise<void> => {
	const apiKey = getRequiredSourcePayloadString(input.sourcePayload, "apiKey");
	const apiUrl = getRequiredSourcePayloadString(input.sourcePayload, "apiUrl");
	const allowInsecureConnections = getOptionalSourcePayloadBoolean(
		input.sourcePayload,
		"allowInsecureConnections",
	);

	await deps.processMediaImport(job, token, {
		...input,
		sourceName: "Audiobookshelf",
		adapterErrorFallback: "Failed to fetch data from Audiobookshelf",
		loadAdapterResult: () => {
			if (!apiKey || !apiUrl) {
				throw new Error("Import job is missing Audiobookshelf credentials");
			}
			return deps.adaptAudiobookshelfData({ apiKey, apiUrl, allowInsecureConnections });
		},
	});
};
