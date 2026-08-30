import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect } from "effect";

import { ImportRunFailuresService, type ImportRunFailureInput } from "../failure-service";
import { ImportsService } from "../service";

export const PROGRESS_UPDATE_INTERVAL = 10;

export const markImportRunStarted = Effect.fn("imports.markImportRunStarted")(function* (
	runId: ImportRunId,
) {
	const startedAt = yield* DateTime.nowAsDate;
	const imports = yield* ImportsService;
	yield* imports.update({ runId, startedAt, status: "running" });
});

export const failImportRun = Effect.fn("imports.failImportRun")(function* (
	runId: ImportRunId,
	failureReason: ImportRunFailureReason,
) {
	const finishedAt = yield* DateTime.nowAsDate;
	const imports = yield* ImportsService;
	yield* imports.update({ runId, finishedAt, failureReason, status: "failed" });
});

export const recordImportRunFailure = Effect.fn("imports.recordImportRunFailure")(function* (
	input: ImportRunFailureInput,
) {
	const failures = yield* ImportRunFailuresService;
	yield* failures.create(input);
});
