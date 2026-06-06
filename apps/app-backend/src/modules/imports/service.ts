import { getTemporaryDirectory } from "~/lib/bun";
import { getQueues } from "~/lib/queue";
import { type ServiceResult, serviceData, serviceError } from "~/lib/result";
import { claimUploadToken } from "~/lib/temporary-upload-token";

import { cleanupImportFile, resolveSafeImportFilePath, validateFileExtension } from "./files";
import { failImportRun } from "./helpers";
import { importRunJobName } from "./jobs";
import {
	createImportRun,
	deleteImportRunById,
	getImportRunById,
	listImportRunFailuresByRunId,
	listImportRunsByUser,
} from "./repository";
import type {
	CreateImportRunBody,
	ImportRunStatus,
	ListedImportRun,
	ListedImportRunFailure,
} from "./schemas";
import {
	buildInputSummary,
	buildSourcePayload,
	getImportSourceStartError,
	getAllowedExtensionsForSource,
} from "./source-config";

type ImportServiceError = "not_found" | "validation";

export type ImportServiceResult<T> = ServiceResult<T, ImportServiceError>;

export const isTerminalStatus = (status: ImportRunStatus): boolean =>
	status === "completed" || status === "failed";

export const startImportRun = async (input: {
	userId: string;
	body: CreateImportRunBody;
}): Promise<ImportServiceResult<{ id: string }>> => {
	const startError = getImportSourceStartError(input.body.source);
	if (startError) {
		return serviceError("validation", startError);
	}

	const inputSummary = buildInputSummary(input.body);
	const allowedExtensions = getAllowedExtensionsForSource(input.body.source);

	if (allowedExtensions) {
		if (!("uploadToken" in input.body)) {
			return serviceError("validation", "Import source requires an upload token");
		}

		const tempDir = getTemporaryDirectory();

		const claimResult = await claimUploadToken(input.body.uploadToken, input.userId);
		if ("error" in claimResult) {
			return serviceError("validation", claimResult.error);
		}

		// Defense-in-depth: verify the claimed path is still within the temp directory.
		const safePathResult = resolveSafeImportFilePath(claimResult.resolvedPath, tempDir);
		if ("error" in safePathResult) {
			await cleanupImportFile(claimResult.resolvedPath);
			return serviceError("validation", safePathResult.error);
		}

		const extResult = validateFileExtension(safePathResult.path, allowedExtensions);
		if ("error" in extResult) {
			await cleanupImportFile(safePathResult.path);
			return serviceError("validation", extResult.error);
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
				filePath: safePathResult.path,
			});
		} catch {
			await failImportRun(run.id, "Failed to enqueue import job");
			await cleanupImportFile(safePathResult.path);
			return serviceError("validation", "Could not queue the import job; please try again");
		}

		return serviceData({ id: run.id });
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
			sourcePayload: buildSourcePayload(input.body),
		});
	} catch {
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
