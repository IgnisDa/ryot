import { getTemporaryDirectory } from "~/lib/bun";
import { getQueues } from "~/lib/queue";
import { type ServiceResult, serviceData, serviceError } from "~/lib/result";
import { claimUploadToken } from "~/lib/temporary-upload-token";

import { importRunJobName } from "./jobs";
import {
	createImportRun,
	deleteImportRunById,
	getImportRunById,
	listImportRunFailuresByRunId,
	listImportRunsByUser,
} from "./repository";
import { failImportRun } from "./runtime/failures";
import {
	cleanupImportFile,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./runtime/files";
import {
	buildInputSummary,
	buildSourcePayload,
	getImportSourceStartError,
	getImportSourceFileInputs,
} from "./runtime/source-definitions";
import {
	deleteImportSourcePayload,
	storeImportSourcePayload,
} from "./runtime/source-payload-store";
import type {
	CreateImportRunBody,
	ImportRunStatus,
	ListedImportRun,
	ListedImportRunFailure,
} from "./schemas";

type ImportServiceError = "not_found" | "validation";

export type ImportServiceResult<T> = ServiceResult<T, ImportServiceError>;

export const isTerminalStatus = (status: ImportRunStatus): boolean =>
	status === "completed" || status === "failed";

const cleanupFilePaths = async (filePaths: string[]) => {
	// oxlint-disable no-await-in-loop
	for (const filePath of new Set(filePaths)) {
		await cleanupImportFile(filePath);
	}
	// oxlint-enable no-await-in-loop
};

export const startImportRun = async (input: {
	userId: string;
	body: CreateImportRunBody;
}): Promise<ImportServiceResult<{ id: string }>> => {
	const startError = getImportSourceStartError(input.body.source);
	if (startError) {
		return serviceError("validation", startError);
	}

	const inputSummary = buildInputSummary(input.body);
	const sourceFileInputs = getImportSourceFileInputs(input.body);

	if (sourceFileInputs.length > 0) {
		const queuedFilePaths: string[] = [];
		const claimedFilePaths: string[] = [];
		const tempDir = getTemporaryDirectory();
		const sourcePayload = buildSourcePayload(input.body) ?? {};

		// oxlint-disable no-await-in-loop
		for (const sourceFileInput of sourceFileInputs) {
			if (!sourceFileInput.uploadToken) {
				if (sourceFileInput.required === false) {
					continue;
				}
				await cleanupFilePaths(claimedFilePaths);
				return serviceError("validation", "Import source requires an upload token");
			}

			const claimResult = await claimUploadToken(sourceFileInput.uploadToken, input.userId);
			if ("error" in claimResult) {
				await cleanupFilePaths(claimedFilePaths);
				return serviceError("validation", claimResult.error);
			}
			claimedFilePaths.push(claimResult.resolvedPath);

			const safePathResult = resolveSafeImportFilePath(claimResult.resolvedPath, tempDir);
			if ("error" in safePathResult) {
				await cleanupFilePaths(claimedFilePaths);
				return serviceError("validation", safePathResult.error);
			}
			const safePath = safePathResult.path;
			claimedFilePaths[claimedFilePaths.length - 1] = safePath;

			const extResult = validateFileExtension(safePath, sourceFileInput.allowedExtensions);
			if ("error" in extResult) {
				await cleanupFilePaths(claimedFilePaths);
				return serviceError("validation", extResult.error);
			}

			queuedFilePaths.push(safePath);
			if (sourceFileInput.payloadKey) {
				sourcePayload[sourceFileInput.payloadKey] = safePath;
			}
		}
		// oxlint-enable no-await-in-loop

		if (queuedFilePaths.length === 0) {
			return serviceError("validation", "Import source requires at least one upload token");
		}

		const run = await createImportRun({
			inputSummary,
			userId: input.userId,
			source: input.body.source,
		});

		try {
			await getQueues().importQueue.add(importRunJobName, {
				runId: run.id,
				userId: input.userId,
				filePath: queuedFilePaths[0],
				...(Object.keys(sourcePayload).length > 0 ? { sourcePayload } : {}),
			});
		} catch {
			await failImportRun(run.id, "Failed to enqueue import job");
			await cleanupFilePaths(claimedFilePaths);
			return serviceError("validation", "Could not queue the import job; please try again");
		}

		return serviceData({ id: run.id });
	}

	const sourcePayload = buildSourcePayload(input.body);
	const run = await createImportRun({
		inputSummary,
		userId: input.userId,
		source: input.body.source,
	});

	if (sourcePayload) {
		try {
			await storeImportSourcePayload({ runId: run.id, sourcePayload });
		} catch {
			await failImportRun(run.id, "Failed to queue import credentials");
			return serviceError("validation", "Could not queue the import job; please try again");
		}
	}

	try {
		await getQueues().importQueue.add(importRunJobName, {
			runId: run.id,
			userId: input.userId,
			...(sourcePayload ? { sourcePayloadKey: run.id } : {}),
		});
	} catch {
		if (sourcePayload) {
			await deleteImportSourcePayload(run.id);
		}
		await failImportRun(run.id, "Failed to enqueue import job");
		return serviceError("validation", "Could not queue the import job; please try again");
	}

	return serviceData({ id: run.id });
};

export const getImportRun = async (input: {
	runId: string;
	userId: string;
}): Promise<ImportServiceResult<ListedImportRun>> => {
	const run = await getImportRunById({ runId: input.runId, userId: input.userId });
	if (!run) {
		return serviceError("not_found", "Import run not found");
	}
	return serviceData(run);
};

export const listImportRuns = async (input: {
	userId: string;
}): Promise<ImportServiceResult<ListedImportRun[]>> => {
	const runs = await listImportRunsByUser({ userId: input.userId });
	return serviceData(runs);
};

export const removeImportRun = async (input: {
	runId: string;
	userId: string;
}): Promise<ImportServiceResult<void>> => {
	const run = await getImportRunById({ runId: input.runId, userId: input.userId });
	if (!run) {
		return serviceError("not_found", "Import run not found");
	}
	if (!isTerminalStatus(run.status)) {
		return serviceError("validation", "Can only delete completed or failed import runs");
	}
	await deleteImportRunById({ runId: input.runId, userId: input.userId });
	return serviceData(undefined);
};

export const listRunFailures = async (input: {
	page: number;
	runId: string;
	limit: number;
	userId: string;
}): Promise<
	ImportServiceResult<{
		page: number;
		total: number;
		limit: number;
		items: ListedImportRunFailure[];
	}>
> => {
	const run = await getImportRunById({ runId: input.runId, userId: input.userId });
	if (!run) {
		return serviceError("not_found", "Import run not found");
	}
	const result = await listImportRunFailuresByRunId({
		page: input.page,
		limit: input.limit,
		runId: input.runId,
	});
	return serviceData({ ...result, page: input.page, limit: input.limit });
};
