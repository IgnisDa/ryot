import { Effect } from "effect";

import { readImportFile } from "../runtime/import-files";
import { sanitizeErrorMessage } from "../runtime/import-run-status";
import type { MediaImportAdapterResult } from "./adapter-result";

export type LoadedMediaImportAdapterResult = {
	cleanupPaths: ReadonlyArray<string>;
	adapterResult: MediaImportAdapterResult;
};

export type LoadedMediaImportAdapterError = {
	message: string;
	cleanupPaths: ReadonlyArray<string>;
};

export const loadMediaTextFileAdapterResult = Effect.fn("imports.loadMediaTextFileAdapterResult")(
	function* (input: {
		filePath?: string;
		sourceName: string;
		adapterErrorFallback?: string;
		loadAdapterResult: (fileText: string) => MediaImportAdapterResult;
	}) {
		const filePath = input.filePath;
		if (!filePath) {
			return yield* Effect.fail({
				cleanupPaths: [],
				message: `Import job is missing ${input.sourceName} export file`,
			} satisfies LoadedMediaImportAdapterError);
		}

		const fileText = yield* readImportFile(filePath).pipe(
			Effect.mapError(
				() =>
					({
						cleanupPaths: [filePath],
						message: "Could not read import file",
					}) satisfies LoadedMediaImportAdapterError,
			),
		);

		const adapterResult = yield* Effect.try({
			try: () => input.loadAdapterResult(fileText),
			catch: (error) => ({
				cleanupPaths: [filePath],
				message: sanitizeErrorMessage(
					error,
					input.adapterErrorFallback ?? `Could not parse ${input.sourceName} import data`,
				),
			}),
		});

		return { adapterResult, cleanupPaths: [filePath] } satisfies LoadedMediaImportAdapterResult;
	},
);
