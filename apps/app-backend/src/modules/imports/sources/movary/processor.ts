import type { Job } from "bullmq";

import { getTemporaryDirectory } from "~/lib/bun";

import {
	processMediaImport,
	type MediaImportAdapterResult,
	type MediaImportJobInput,
} from "../../media/import-processor";
import {
	cleanupImportFile,
	readImportFile,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "../../runtime/files";
import { adaptMovaryExports } from "./adapter";

const MOVARY_EXTENSIONS = ["csv"];

type MovaryImportProcessorDeps = {
	readImportFile: typeof readImportFile;
	cleanupImportFile: typeof cleanupImportFile;
	processMediaImport: typeof processMediaImport;
	adaptMovaryExports: typeof adaptMovaryExports;
};

const movaryImportProcessorDeps: MovaryImportProcessorDeps = {
	readImportFile,
	cleanupImportFile,
	processMediaImport,
	adaptMovaryExports,
};

const getValidatedOptionalPath = (value: unknown): string | undefined => {
	if (typeof value !== "string" || value.trim().length === 0) {
		return undefined;
	}

	const tempDir = getTemporaryDirectory();
	const safePathResult = resolveSafeImportFilePath(value, tempDir);
	if ("error" in safePathResult) {
		throw new Error(safePathResult.error);
	}

	const extResult = validateFileExtension(safePathResult.path, MOVARY_EXTENSIONS);
	if ("error" in extResult) {
		throw new Error(extResult.error);
	}

	return safePathResult.path;
};

export const processMovaryImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & { filePath?: string; sourcePayload?: Record<string, unknown> },
	deps: MovaryImportProcessorDeps = movaryImportProcessorDeps,
): Promise<void> => {
	const historyFilePath =
		getValidatedOptionalPath(input.sourcePayload?.historyFilePath) ?? input.filePath;
	const ratingsFilePath = getValidatedOptionalPath(input.sourcePayload?.ratingsFilePath);
	const watchlistFilePath = getValidatedOptionalPath(input.sourcePayload?.watchlistFilePath);
	const cleanupPaths = [historyFilePath, ratingsFilePath, watchlistFilePath].filter(
		(filePath): filePath is string => Boolean(filePath),
	);

	await deps.processMediaImport(job, token, {
		...input,
		sourceName: "Movary",
		adapterErrorFallback: "Could not parse Movary export data",
		cleanup: async () => {
			for (const filePath of new Set(cleanupPaths)) {
				// oxlint-disable-next-line no-await-in-loop
				await deps.cleanupImportFile(filePath);
			}
		},
		loadAdapterResult: async (): Promise<MediaImportAdapterResult> => {
			if (!historyFilePath || !ratingsFilePath || !watchlistFilePath) {
				throw new Error("Import job is missing Movary export files");
			}

			const [historyCsv, ratingsCsv, watchlistCsv] = await Promise.all([
				deps.readImportFile(historyFilePath),
				deps.readImportFile(ratingsFilePath),
				deps.readImportFile(watchlistFilePath),
			]);
			return deps.adaptMovaryExports({ historyCsv, ratingsCsv, watchlistCsv });
		},
	});
};
