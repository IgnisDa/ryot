import { Effect, Either } from "effect";

import type {
	LoadedMediaImportAdapterError,
	LoadedMediaImportAdapterResult,
} from "../../media/file-processor";
import { sanitizeErrorMessage } from "../../runtime/failures";
import { getValidatedOptionalPath, readImportFile } from "../../runtime/files";
import { adaptMovaryExports } from "./adapter";

const MOVARY_EXTENSIONS = ["csv"];

export const loadMovaryAdapterResult = (input: {
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
			return yield* Effect.fail({
				cleanupPaths: [],
				message: paths.left,
			} satisfies LoadedMediaImportAdapterError);
		}

		const { historyFilePath, ratingsFilePath, watchlistFilePath } = paths.right;
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
			try: () => adaptMovaryExports({ historyCsv, ratingsCsv, watchlistCsv }),
			catch: (error) =>
				({
					cleanupPaths,
					message: sanitizeErrorMessage(error, "Could not parse Movary export data"),
				}) satisfies LoadedMediaImportAdapterError,
		});

		return { adapterResult, cleanupPaths } satisfies LoadedMediaImportAdapterResult;
	});
