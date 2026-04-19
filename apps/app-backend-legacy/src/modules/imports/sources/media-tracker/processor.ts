import type { Job } from "bullmq";

import { processMediaImport, type MediaImportJobInput } from "../../media/import-processor";
import {
	getOptionalSourcePayloadBoolean,
	getRequiredSourcePayloadString,
} from "../shared/source-payload";
import { adaptMediaTrackerData } from "./adapter";

export type MediaTrackerImportProcessorDeps = {
	processMediaImport: typeof processMediaImport;
	adaptMediaTrackerData: typeof adaptMediaTrackerData;
};

const mediaTrackerImportProcessorDeps: MediaTrackerImportProcessorDeps = {
	processMediaImport,
	adaptMediaTrackerData,
};

export const processMediaTrackerImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & { sourcePayload: Record<string, unknown> | undefined },
	deps: MediaTrackerImportProcessorDeps = mediaTrackerImportProcessorDeps,
): Promise<void> => {
	const apiKey = getRequiredSourcePayloadString(input.sourcePayload, "apiKey");
	const apiUrl = getRequiredSourcePayloadString(input.sourcePayload, "apiUrl");
	const allowInsecureConnections = getOptionalSourcePayloadBoolean(
		input.sourcePayload,
		"allowInsecureConnections",
	);

	await deps.processMediaImport(job, token, {
		...input,
		sourceName: "MediaTracker",
		adapterErrorFallback: "Failed to fetch data from MediaTracker",
		loadAdapterResult: () => {
			if (!apiKey || !apiUrl) {
				throw new Error("Import job is missing MediaTracker credentials");
			}
			return deps.adaptMediaTrackerData({ apiKey, apiUrl, allowInsecureConnections });
		},
	});
};
