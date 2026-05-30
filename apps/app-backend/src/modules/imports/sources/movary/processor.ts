import { Effect } from "effect";

import { AppConfig } from "#lib/config";

import { nowIso } from "../../media/dates";
import type {
	LoadedMediaImportAdapterError,
	LoadedMediaImportAdapterResult,
} from "../../media/file-processor";
import { sanitizeErrorMessage } from "../../runtime/failures";
import { getValidatedOptionalPath, readImportFile } from "../../runtime/files";
import { adaptMovaryExports } from "./adapter";

const MOVARY_EXTENSIONS = ["csv"];

const toMovaryLoadError = (message: string) =>
	({ cleanupPaths: [], message }) satisfies LoadedMediaImportAdapterError;

export const loadMovaryAdapterResult = Effect.fn("movaryProcessor.load")(function* (input: {
	runId: string;
	userId: string;
	filePath?: string;
	sourcePayload?: Record<string, unknown>;
}) {
	const config = yield* AppConfig;
	const { historyFilePath, ratingsFilePath, watchlistFilePath } = yield* Effect.all({
		historyFilePath: getValidatedOptionalPath(
			input.sourcePayload?.historyFilePath,
			MOVARY_EXTENSIONS,
			config.tmpDir,
		).pipe(Effect.map((p) => p ?? input.filePath)),
		ratingsFilePath: getValidatedOptionalPath(
			input.sourcePayload?.ratingsFilePath,
			MOVARY_EXTENSIONS,
			config.tmpDir,
		),
		watchlistFilePath: getValidatedOptionalPath(
			input.sourcePayload?.watchlistFilePath,
			MOVARY_EXTENSIONS,
			config.tmpDir,
		),
	}).pipe(Effect.mapError(toMovaryLoadError));
	const cleanupPaths = [historyFilePath, ratingsFilePath, watchlistFilePath].filter(
		(filePath): filePath is string => Boolean(filePath),
	);

	if (!historyFilePath || !ratingsFilePath || !watchlistFilePath) {
		return yield* Effect.fail({
			cleanupPaths,
			message: "Import job is missing Movary export files",
		} satisfies LoadedMediaImportAdapterError);
	}

	const [historyCsv, ratingsCsv, watchlistCsv] = yield* Effect.all([
		readImportFile(historyFilePath),
		readImportFile(ratingsFilePath),
		readImportFile(watchlistFilePath),
	]).pipe(
		Effect.mapError(
			() =>
				({
					cleanupPaths,
					message: "Could not read import file",
				}) satisfies LoadedMediaImportAdapterError,
		),
	);

	const adapterResult = yield* Effect.try({
		try: () => adaptMovaryExports({ historyCsv, ratingsCsv, watchlistCsv, importedAt: nowIso() }),
		catch: (error) =>
			({
				cleanupPaths,
				message: sanitizeErrorMessage(error, "Could not parse Movary export data"),
			}) satisfies LoadedMediaImportAdapterError,
	});

	return { adapterResult, cleanupPaths } satisfies LoadedMediaImportAdapterResult;
});
