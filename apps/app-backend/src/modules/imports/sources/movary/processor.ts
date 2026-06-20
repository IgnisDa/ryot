import type { ImportRunId, UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { AppConfig } from "#lib/config/service";

import { nowIso } from "../../media/dates";
import type {
	LoadedMediaImportAdapterError,
	LoadedMediaImportAdapterResult,
} from "../../media/file-processor";
import { getValidatedOptionalPath, readImportFile } from "../../runtime/import-files";
import { sanitizeErrorMessage } from "../../runtime/import-run-status";
import { adaptMovaryExports } from "./adapter";

const MOVARY_EXTENSIONS = ["csv"];

const toMovaryLoadError = (message: string) =>
	({ cleanupPaths: [], message }) satisfies LoadedMediaImportAdapterError;

export const loadMovaryAdapterResult = Effect.fn("movaryProcessor.load")(function* (input: {
	runId: ImportRunId;
	userId: UserId;
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
