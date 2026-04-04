import type { ImportRunId } from "@ryot/contract/schema/brands";
import { DateTime, Effect } from "effect";

import {
	ImportRunFailuresService,
	type ImportRunFailureDetails,
	type ImportRunFailureInput,
} from "../failure-service";
import { ImportsService } from "../service";

export const PROGRESS_UPDATE_INTERVAL = 10;

export const sanitizeErrorMessage = (error: unknown, fallback: string): string =>
	error instanceof Error ? error.message : fallback;

export const markImportRunStarted = Effect.fn("imports.markImportRunStarted")(function* (
	runId: ImportRunId,
) {
	const startedAt = yield* DateTime.nowAsDate;
	const imports = yield* ImportsService;
	yield* imports.update({ runId, status: "running", startedAt });
});

export const failImportRun = Effect.fn("imports.failImportRun")(function* (
	runId: ImportRunId,
	errorSummary: string,
) {
	const finishedAt = yield* DateTime.nowAsDate;
	const imports = yield* ImportsService;
	yield* imports.update({ runId, errorSummary, status: "failed", finishedAt });
});

export const recordImportRunFailure = Effect.fn("imports.recordImportRunFailure")(function* (
	input: ImportRunFailureInput,
) {
	const failures = yield* ImportRunFailuresService;
	yield* failures.create(input);
});

export const failImportRunWithFailures = Effect.fn("imports.failImportRunWithFailures")(
	function* (input: {
		runId: ImportRunId;
		errorSummary?: string;
		failures: ReadonlyArray<ImportRunFailureDetails>;
	}) {
		const imports = yield* ImportsService;
		const failureCount = input.failures.length;
		const errorSummary = input.errorSummary ?? input.failures[0]?.message ?? "Import run failed";

		for (const failure of input.failures) {
			yield* recordImportRunFailure({ ...failure, runId: input.runId });
		}

		const finishedAt = yield* DateTime.nowAsDate;
		yield* imports.update({
			finishedAt,
			errorSummary,
			progress: 100,
			status: "failed",
			runId: input.runId,
			totalItems: failureCount,
			failedItems: failureCount,
			processedItems: failureCount,
		});
	},
);
