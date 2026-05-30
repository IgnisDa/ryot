import type { Job } from "bullmq";

import { processMediaImport, type MediaImportJobInput } from "../../media/import-processor";
import {
	getRequiredSourcePayloadString,
	getOptionalSourcePayloadBoolean,
} from "../shared/source-payload";
import { adaptPlexData } from "./adapter";

export type PlexImportProcessorDeps = {
	adaptPlexData: typeof adaptPlexData;
	processMediaImport: typeof processMediaImport;
};

const plexImportProcessorDeps: PlexImportProcessorDeps = {
	adaptPlexData,
	processMediaImport,
};

export const processPlexImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & { sourcePayload: Record<string, unknown> | undefined },
	deps: PlexImportProcessorDeps = plexImportProcessorDeps,
): Promise<void> => {
	const apiKey = getRequiredSourcePayloadString(input.sourcePayload, "apiKey");
	const apiUrl = getRequiredSourcePayloadString(input.sourcePayload, "apiUrl");
	const allowInsecureConnections = getOptionalSourcePayloadBoolean(
		input.sourcePayload,
		"allowInsecureConnections",
	);

	await deps.processMediaImport(job, token, {
		...input,
		sourceName: "Plex",
		adapterErrorFallback: "Failed to fetch data from Plex",
		loadAdapterResult: () => {
			if (!apiKey || !apiUrl) {
				throw new Error("Import job is missing Plex credentials");
			}
			return deps.adaptPlexData({ apiKey, apiUrl, allowInsecureConnections });
		},
	});
};
