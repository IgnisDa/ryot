import { type Job, WaitingChildrenError } from "bullmq";

import { getTemporaryDirectory } from "~/lib/bun";

import {
	cleanupImportFile,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./file-helpers";
import type { ImportEntityRef, ImportMediaEntityGroup, ImportRunJobData } from "./jobs";
import { getImportRunById, updateImportRun } from "./repository";
import { processHevyImport } from "./sources/hevy/processor";
import { processOpenScaleImport } from "./sources/open-scale/processor";
import { processStrongAppImport } from "./sources/strong-app/processor";
import { processTraktImport } from "./sources/trakt/processor";

const allowedExtensionsBySource: Record<string, string[]> = {
	hevy: ["csv"],
	open_scale: ["csv"],
	strong_app: ["csv"],
};

const sanitizeErrorMessage = (error: unknown, fallback: string): string => {
	if (!(error instanceof Error)) {
		return fallback;
	}
	return error.message;
};

export const processImportJob = async (input: {
	job: Job;
	runId: string;
	token?: string;
	userId: string;
	filePath?: string;
	traktUsername?: string;
	providerEntityIndex?: number;
	adapterFailureCount?: number;
	mediaWriteGroupIndex?: number;
	providerSandboxJobId?: string;
	mediaWriteFailedItems?: number;
	mediaWriteImportedItems?: number;
	providerFailedIndices?: number[];
	providerEntityRefs?: ImportEntityRef[];
	providerEntityIds?: Array<string | null>;
	importStep?: ImportRunJobData["importStep"];
	mediaEntityGroups?: ImportMediaEntityGroup[];
}): Promise<void> => {
	const { runId, userId } = input;

	const run = await getImportRunById({ runId, userId });
	if (!run) {
		throw new Error(`Import run '${runId}' not found`);
	}

	if (!input.importStep) {
		await updateImportRun({ status: "running", runId, startedAt: new Date() });
	}

	if (run.source === "trakt") {
		const traktUsername = input.traktUsername?.trim();
		if (!traktUsername) {
			await updateImportRun({
				runId,
				status: "failed",
				finishedAt: new Date(),
				errorSummary: "Import job is missing Trakt username",
			});
			throw new Error("Import job is missing Trakt username");
		}

		try {
			await processTraktImport(input.job, input.token, {
				runId,
				userId,
				traktUsername,
				importStep: input.importStep,
				mediaEntityGroups: input.mediaEntityGroups,
				providerEntityIds: input.providerEntityIds,
				providerEntityRefs: input.providerEntityRefs,
				providerEntityIndex: input.providerEntityIndex,
				adapterFailureCount: input.adapterFailureCount,
				providerSandboxJobId: input.providerSandboxJobId,
				mediaWriteGroupIndex: input.mediaWriteGroupIndex,
				providerFailedIndices: input.providerFailedIndices,
				mediaWriteFailedItems: input.mediaWriteFailedItems,
				mediaWriteImportedItems: input.mediaWriteImportedItems,
			});
		} catch (error) {
			if (error instanceof WaitingChildrenError) {
				throw error;
			}
			const message = sanitizeErrorMessage(error, "Import job failed unexpectedly");
			try {
				await updateImportRun({
					runId,
					status: "failed",
					errorSummary: message,
					finishedAt: new Date(),
				});
			} catch {}
			throw error;
		}
		return;
	}

	const tempDir = getTemporaryDirectory();

	const safePathResult = resolveSafeImportFilePath(input.filePath ?? "", tempDir);
	if ("error" in safePathResult) {
		await updateImportRun({
			runId,
			status: "failed",
			finishedAt: new Date(),
			errorSummary: "Import job has an invalid file path",
		});
		throw new Error("Import job has an invalid file path");
	}

	const safePath = safePathResult.path;

	const knownImportExtensions = [...new Set(Object.values(allowedExtensionsBySource).flat())];
	const extResult = validateFileExtension(safePath, knownImportExtensions);
	if ("error" in extResult) {
		await cleanupImportFile(safePath);
		await updateImportRun({
			runId,
			status: "failed",
			finishedAt: new Date(),
			errorSummary: "Import job has an invalid file extension",
		});
		throw new Error("Import job has an invalid file extension");
	}

	try {
		if (run.source === "hevy") {
			await processHevyImport({ runId, userId, filePath: safePath });
		} else if (run.source === "open_scale") {
			await processOpenScaleImport({ runId, userId, filePath: safePath });
		} else if (run.source === "strong_app") {
			await processStrongAppImport({ runId, userId, filePath: safePath });
		} else {
			await updateImportRun({
				runId,
				status: "failed",
				finishedAt: new Date(),
				errorSummary: `Unsupported import source: ${run.source}`,
			});
		}
	} catch (error) {
		const message = sanitizeErrorMessage(error, "Import job failed unexpectedly");
		try {
			await updateImportRun({
				runId,
				status: "failed",
				errorSummary: message,
				finishedAt: new Date(),
			});
		} catch {
			// best effort
		}
		throw error;
	}
};
