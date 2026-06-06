import { Effect, Either } from "effect";

import { processMediaImport } from "../../media/import-processor";
import { failImportRun, sanitizeErrorMessage } from "../../runtime/failures";
import { cleanupImportFile, getValidatedOptionalPath, readImportFile } from "../../runtime/files";
import { adaptMovaryExports } from "./adapter";

const MOVARY_EXTENSIONS = ["csv"];

export const processMovaryImport = (input: {
	runId: string;
	userId: string;
	filePath?: string;
	sourcePayload?: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const paths = yield* Effect.try({
			try: () => ({
				historyFilePath:
					getValidatedOptionalPath(input.sourcePayload?.historyFilePath, MOVARY_EXTENSIONS) ??
					input.filePath,
				ratingsFilePath: getValidatedOptionalPath(
					input.sourcePayload?.ratingsFilePath,
					MOVARY_EXTENSIONS,
				),
				watchlistFilePath: getValidatedOptionalPath(
					input.sourcePayload?.watchlistFilePath,
					MOVARY_EXTENSIONS,
				),
			}),
			catch: (error) => sanitizeErrorMessage(error, "Import job has invalid Movary files"),
		}).pipe(Effect.either);

		if (Either.isLeft(paths)) {
			yield* failImportRun(input.runId, paths.left);
			return;
		}

		const { historyFilePath, ratingsFilePath, watchlistFilePath } = paths.right;
		const cleanupPaths = [historyFilePath, ratingsFilePath, watchlistFilePath].filter(
			(filePath): filePath is string => Boolean(filePath),
		);

		yield* processMediaImport({
			runId: input.runId,
			userId: input.userId,
			sourceName: "Movary",
			adapterErrorFallback: "Could not parse Movary export data",
			loadAdapterResult: Effect.gen(function* () {
				if (!historyFilePath || !ratingsFilePath || !watchlistFilePath) {
					return yield* Effect.fail("Import job is missing Movary export files");
				}
				const [historyCsv, ratingsCsv, watchlistCsv] = yield* Effect.all([
					readImportFile(historyFilePath),
					readImportFile(ratingsFilePath),
					readImportFile(watchlistFilePath),
				]).pipe(Effect.mapError(() => "Could not read import file"));
				return yield* Effect.try({
					try: () => adaptMovaryExports({ historyCsv, ratingsCsv, watchlistCsv }),
					catch: (error) => sanitizeErrorMessage(error, "Could not parse Movary export data"),
				});
			}),
		}).pipe(
			Effect.ensuring(Effect.forEach(new Set(cleanupPaths), cleanupImportFile, { discard: true })),
		);
	});
