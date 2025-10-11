import type { Job } from "bullmq";

import { config } from "~/lib/config";

import { failImportRun } from "../../helpers";
import { processMediaImport, type MediaImportJobInput } from "../../media/import-processor";
import { updateImportRun } from "../../repository";
import { adaptTraktData } from "./adapter";

export type TraktImportProcessorDeps = {
	adaptTraktData: typeof adaptTraktData;
	updateImportRun: typeof updateImportRun;
	processMediaImport: typeof processMediaImport;
	getTraktClientId: () => string | undefined;
};

const traktImportProcessorDeps: TraktImportProcessorDeps = {
	adaptTraktData,
	updateImportRun,
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
	if (!username) {
		await failImportRun(input.runId, "Import job is missing Trakt username", deps.updateImportRun);
		return;
	}

	const clientId = deps.getTraktClientId();
	if (!clientId) {
		await failImportRun(
			input.runId,
			"Trakt importer is not configured. Set SERVER_IMPORTER_TRAKT_CLIENT_ID.",
			deps.updateImportRun,
		);
		return;
	}

	await deps.processMediaImport(job, token, {
		...input,
		sourceName: "Trakt",
		jobData: { sourcePayload: { username } },
		adapterErrorFallback: "Failed to fetch data from Trakt",
		loadAdapterResult: () => deps.adaptTraktData(username, clientId),
	});
};
