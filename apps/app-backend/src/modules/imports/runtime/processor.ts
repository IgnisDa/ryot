import { WaitingChildrenError } from "bullmq";

import { getTemporaryDirectory } from "~/lib/bun";

import { getImportRunById, updateImportRun } from "../repository";
import { failImportRun, sanitizeErrorMessage } from "./failures";
import { cleanupImportFile, resolveSafeImportFilePath, validateFileExtension } from "./files";
import { getImportSourceProcessor, type SourceProcessorInput } from "./processor-registry";
import { getKnownImportExtensions } from "./source-definitions";

const resolveImportJobFilePath = async (input: {
	runId: string;
	filePath: string | undefined;
}): Promise<string> => {
	const tempDir = getTemporaryDirectory();
	const safePathResult = resolveSafeImportFilePath(input.filePath ?? "", tempDir);
	if ("error" in safePathResult) {
		await failImportRun(input.runId, "Import job has an invalid file path");
		throw new Error("Import job has an invalid file path");
	}

	const safePath = safePathResult.path;
	const extResult = validateFileExtension(safePath, getKnownImportExtensions());
	if ("error" in extResult) {
		await cleanupImportFile(safePath);
		await failImportRun(input.runId, "Import job has an invalid file extension");
		throw new Error("Import job has an invalid file extension");
	}

	return safePath;
};

const processWithFailureHandling = async (
	runId: string,
	process: () => Promise<void>,
): Promise<void> => {
	try {
		await process();
	} catch (error) {
		if (error instanceof WaitingChildrenError) {
			throw error;
		}
		const message = sanitizeErrorMessage(error, "Import job failed unexpectedly");
		try {
			await failImportRun(runId, message);
		} catch {
			// best effort
		}
		throw error;
	}
};

export const processImportJob = async (input: SourceProcessorInput): Promise<void> => {
	const { runId, userId } = input;

	const run = await getImportRunById({ runId, userId });
	if (!run) {
		throw new Error(`Import run '${runId}' not found`);
	}

	if (!input.importStep) {
		await updateImportRun({ status: "running", runId, startedAt: new Date() });
	}

	const sourceProcessor = getImportSourceProcessor(run.source);
	if (!sourceProcessor) {
		await failImportRun(runId, `Unsupported import source: ${run.source}`);
		return;
	}

	if (sourceProcessor.inputKind === "file") {
		const safePath = await resolveImportJobFilePath({ runId, filePath: input.filePath });
		await processWithFailureHandling(runId, () =>
			sourceProcessor.process({ ...input, filePath: safePath }),
		);
		return;
	}

	await processWithFailureHandling(runId, () => sourceProcessor.process(input));
};
