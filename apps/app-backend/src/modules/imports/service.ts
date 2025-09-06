import { getTemporaryDirectory } from "~/lib/bun";
import { config } from "~/lib/config";
import { getQueues } from "~/lib/queue";
import { type ServiceResult, serviceData, serviceError } from "~/lib/result";
import { claimUploadToken } from "~/lib/temporary-upload-token";

import {
	cleanupImportFile,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./file-helpers";
import { importRunJobName } from "./jobs";
import {
	createImportRun,
	deleteImportRunById,
	getImportRunById,
	listImportRunFailuresByRunId,
	listImportRunsByUser,
	updateImportRun,
} from "./repository";
import type {
	CreateImportRunBody,
	ImportRunStatus,
	ListedImportRun,
	ListedImportRunFailure,
} from "./schemas";

type ImportServiceError = "not_found" | "validation";

export type ImportServiceResult<T> = ServiceResult<T, ImportServiceError>;

const allowedExtensionsBySource: Record<string, string[]> = {
	open_scale: ["csv"],
	strong_app: ["csv"],
};

const buildFileInputSummary = (source: "open_scale" | "strong_app"): Record<string, unknown> => ({
	source,
});

const buildTraktInputSummary = (username: string): Record<string, unknown> => ({
	username,
	source: "trakt",
});

export const isTerminalStatus = (status: ImportRunStatus): boolean =>
	status === "completed" || status === "failed";

export const startImportRun = async (input: {
	userId: string;
	body: CreateImportRunBody;
}): Promise<ImportServiceResult<{ id: string }>> => {
	if (input.body.source === "open_scale" || input.body.source === "strong_app") {
		const tempDir = getTemporaryDirectory();
		const allowedExtensions = allowedExtensionsBySource[input.body.source];
		if (!allowedExtensions) {
			return serviceError("validation", `Unsupported import source: ${input.body.source}`);
		}

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

		const inputSummary = buildFileInputSummary(input.body.source);

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
			await updateImportRun({
				runId: run.id,
				status: "failed",
				finishedAt: new Date(),
				errorSummary: "Failed to enqueue import job",
			});
			await cleanupImportFile(safePathResult.path);
			return serviceError("validation", "Could not queue the import job; please try again");
		}

		return serviceData({ id: run.id });
	}

	if (!config.importer.trakt.clientId) {
		return serviceError(
			"validation",
			"Trakt importer is not configured. Set SERVER_IMPORTER_TRAKT_CLIENT_ID.",
		);
	}

	const inputSummary = buildTraktInputSummary(input.body.username);

	const run = await createImportRun({
		inputSummary,
		userId: input.userId,
		source: input.body.source,
	});

	try {
		await getQueues().importQueue.add(importRunJobName, {
			runId: run.id,
			userId: input.userId,
			traktUsername: input.body.username,
		});
	} catch {
		await updateImportRun({
			runId: run.id,
			status: "failed",
			finishedAt: new Date(),
			errorSummary: "Failed to enqueue import job",
		});
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
