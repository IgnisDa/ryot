import type { Job } from "bullmq";

import { processMediaImport, type MediaImportJobInput } from "../../media/import-processor";
import {
	getOptionalSourcePayloadBoolean,
	getOptionalSourcePayloadString,
	getRequiredSourcePayloadString,
} from "../shared/source-payload";
import { adaptJellyfinData } from "./adapter";

export type JellyfinImportProcessorDeps = {
	adaptJellyfinData: typeof adaptJellyfinData;
	processMediaImport: typeof processMediaImport;
};

const jellyfinImportProcessorDeps: JellyfinImportProcessorDeps = {
	adaptJellyfinData,
	processMediaImport,
};

export const processJellyfinImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & { sourcePayload: Record<string, unknown> | undefined },
	deps: JellyfinImportProcessorDeps = jellyfinImportProcessorDeps,
): Promise<void> => {
	const apiUrl = getRequiredSourcePayloadString(input.sourcePayload, "apiUrl");
	const username = getRequiredSourcePayloadString(input.sourcePayload, "username");
	const password = getOptionalSourcePayloadString(input.sourcePayload, "password");
	const allowInsecureConnections = getOptionalSourcePayloadBoolean(
		input.sourcePayload,
		"allowInsecureConnections",
	);

	await deps.processMediaImport(job, token, {
		...input,
		sourceName: "Jellyfin",
		adapterErrorFallback: "Failed to fetch data from Jellyfin",
		loadAdapterResult: () => {
			if (!apiUrl || !username) {
				throw new Error("Import job is missing Jellyfin connection details");
			}
			return deps.adaptJellyfinData({ apiUrl, username, password, allowInsecureConnections });
		},
	});
};
