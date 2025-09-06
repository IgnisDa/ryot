import type { Job } from "bullmq";

import { config } from "~/lib/config";

import type { ImportEntityRef, ImportMediaEntityGroup, ImportRunJobData } from "../../jobs";
import { processMediaImport } from "../../media/import-processor";
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
	input: {
		runId: string;
		userId: string;
		sourcePayload: Record<string, unknown> | undefined;
		providerEntityIndex: number | undefined;
		adapterFailureCount: number | undefined;
		providerSandboxJobId: string | undefined;
		mediaWriteGroupIndex: number | undefined;
		mediaWriteFailedItems: number | undefined;
		importStep: ImportRunJobData["importStep"];
		providerFailedIndices: number[] | undefined;
		mediaWriteImportedItems: number | undefined;
		providerEntityRefs: ImportEntityRef[] | undefined;
		providerEntityIds: Array<string | null> | undefined;
		mediaEntityGroups: ImportMediaEntityGroup[] | undefined;
	},
	deps: TraktImportProcessorDeps = traktImportProcessorDeps,
): Promise<void> => {
	const username = getTraktUsername(input.sourcePayload);
	if (!username) {
		await deps.updateImportRun({
			runId: input.runId,
			status: "failed",
			finishedAt: new Date(),
			errorSummary: "Import job is missing Trakt username",
		});
		return;
	}

	const clientId = deps.getTraktClientId();
	if (!clientId) {
		await deps.updateImportRun({
			runId: input.runId,
			status: "failed",
			finishedAt: new Date(),
			errorSummary: "Trakt importer is not configured. Set SERVER_IMPORTER_TRAKT_CLIENT_ID.",
		});
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
