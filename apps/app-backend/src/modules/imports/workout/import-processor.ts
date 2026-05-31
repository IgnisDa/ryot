import { Effect, Either } from "effect";

import { AppConfig } from "~/lib/config";

import { failImportRun, sanitizeErrorMessage } from "../runtime/failures";
import { cleanupImportFile, readImportFile } from "../runtime/files";
import type { WorkoutAdapterResult } from "./domain";
import { processWorkoutImportResult } from "./processor";

export const processWorkoutCsvImport = (input: {
	runId: string;
	userId: string;
	filePath: string;
	sourceName: string;
	adapt: (csvText: string, timezone: string) => WorkoutAdapterResult;
}) =>
	Effect.gen(function* () {
		const config = yield* AppConfig;

		const csvText = yield* readImportFile(input.filePath).pipe(Effect.either);
		if (Either.isLeft(csvText)) {
			yield* failImportRun(input.runId, "Could not read import file");
			return;
		}

		const adapterResult = yield* Effect.try({
			try: () => input.adapt(csvText.right, config.timezone),
			catch: (error) => sanitizeErrorMessage(error, `Could not parse ${input.sourceName} CSV`),
		}).pipe(Effect.either);
		if (Either.isLeft(adapterResult)) {
			yield* failImportRun(input.runId, adapterResult.left);
			return;
		}

		yield* processWorkoutImportResult({
			runId: input.runId,
			userId: input.userId,
			adapterResult: adapterResult.right,
		});
	}).pipe(Effect.ensuring(cleanupImportFile(input.filePath)));
