import type { Job } from "bullmq";

import { config } from "~/lib/config";

import { processMediaImport, type MediaImportJobInput } from "../../media/import-processor";
import { adaptTraktData } from "./adapter";

export type TraktImportProcessorDeps = {
	adaptTraktData: typeof adaptTraktData;
	processMediaImport: typeof processMediaImport;
	getTraktClientId: () => string | undefined;
};

const traktImportProcessorDeps: TraktImportProcessorDeps = {
	adaptTraktData,
	processMediaImport,
	getTraktClientId: () => config.importer.trakt.clientId,
};

const getTraktUsername = (sourcePayload: Record<string, unknown> | undefined): string => {
	const username = sourcePayload?.username;
	return typeof username === "string" ? username.trim() : "";
};

export const processTraktImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & {
		sourcePayload: Record<string, unknown> | undefined;
	},
	deps: TraktImportProcessorDeps = traktImportProcessorDeps,
): Promise<void> => {
	const username = getTraktUsername(input.sourcePayload);

	await deps.processMediaImport(job, token, {
		...input,
		sourceName: "Trakt",
		adapterErrorFallback: "Failed to fetch data from Trakt",
		loadAdapterResult: () => {
			if (!username) {
				throw new Error("Import job is missing Trakt username");
			}
			const clientId = deps.getTraktClientId();
			if (!clientId) {
				throw new Error("Trakt importer is not configured. Set SERVER_IMPORTER_TRAKT_CLIENT_ID.");
			}
			return deps.adaptTraktData(username, clientId);
		},
	});
};
