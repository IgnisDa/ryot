import { Effect } from "effect";

import { sanitizeErrorMessage } from "../runtime/failures";
import { cleanupImportFile, readImportFile } from "../runtime/files";
import { type MediaImportAdapterResult, processMediaImport } from "./import-processor";

export const processMediaTextFileImport = (input: {
	runId: string;
	userId: string;
	filePath: string;
	sourceName: string;
	adapterErrorFallback?: string;
	loadAdapterResult: (fileText: string) => MediaImportAdapterResult;
}) =>
	processMediaImport({
		runId: input.runId,
		userId: input.userId,
		sourceName: input.sourceName,
		adapterErrorFallback:
			input.adapterErrorFallback ?? `Could not parse ${input.sourceName} import data`,
		loadAdapterResult: Effect.gen(function* () {
			const fileText = yield* readImportFile(input.filePath).pipe(
				Effect.mapError(() => "Could not read import file"),
			);
			return yield* Effect.try({
				try: () => input.loadAdapterResult(fileText),
				catch: (error) =>
					sanitizeErrorMessage(
						error,
						input.adapterErrorFallback ?? `Could not parse ${input.sourceName} import data`,
					),
			});
		}),
	}).pipe(Effect.ensuring(cleanupImportFile(input.filePath)));
