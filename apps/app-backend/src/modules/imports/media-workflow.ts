import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Effect } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

import type { ImportRunJobData } from "./jobs";
import { loadMediaAdapterResult } from "./media/load-workflow";
import { ProcessNormalizedMediaImportWorkflow } from "./media/normalized-import-workflow";
import { resolveImportPath } from "./runtime/import-files";
import { markImportRunStarted } from "./runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";
import { createImportRunLifecycle } from "./runtime/workflow-helpers";

const cleanupMediaImportRun = (input: {
	payload: ImportRunJobData;
	cleanupPaths: ReadonlyArray<string>;
}) => {
	const { cleanupArtifactsBestEffort } = createImportRunLifecycle(input.payload);
	return cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success", input.cleanupPaths);
};

const mergeCleanupPaths = (
	initialCleanupPaths: ReadonlyArray<string>,
	loadedCleanupPaths: ReadonlyArray<string>,
) => [...new Set([...initialCleanupPaths, ...loadedCleanupPaths])];

export const runOneTimeMediaImportWorkflow = Effect.fn("runOneTimeMediaImportWorkflow")(function* (
	payload: ImportRunJobData,
	executionId: string,
) {
	const config = yield* AppConfig;
	const engine = yield* WorkflowEngine;
	const initialCleanupPaths = payload.filePath
		? yield* resolveImportPath(payload.filePath, config.tmpDir)
		: [];
	let cleanupPaths: ReadonlyArray<string> = initialCleanupPaths;
	const { failRunAndCleanup } = createImportRunLifecycle(payload);

	const processWorkflow = Effect.gen(function* () {
		yield* Activity.make({
			error: ImportRunError,
			name: "mark-import-run-started",
			execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toWorkflowError)),
		});

		const loadOutcome = yield* loadMediaAdapterResult({ payload, executionId });
		if (loadOutcome._tag === "failed" && !loadOutcome.fallbackToInitialCleanupPaths) {
			cleanupPaths = [...loadOutcome.cleanupPaths];
		} else {
			cleanupPaths = mergeCleanupPaths(initialCleanupPaths, loadOutcome.cleanupPaths);
		}

		if (loadOutcome._tag === "failed") {
			yield* failRunAndCleanup({
				cleanupPaths,
				message: loadOutcome.message,
				failureName: "fail-import-run-on-load-error",
				cleanupName: "cleanup-import-artifacts-on-load-failure",
			});
			return;
		}

		const childExecutionId = `${executionId}-normalized`;
		yield* engine.execute(ProcessNormalizedMediaImportWorkflow, {
			executionId: childExecutionId,
			payload: {
				executionId: childExecutionId,
				runId: payload.runId,
				userId: payload.userId,
			},
		});

		yield* cleanupMediaImportRun({ cleanupPaths, payload });
	});

	yield* processWorkflow.pipe(
		Effect.catchAllCause((cause) =>
			failRunAndCleanup({
				failureName: "fail-import-run-unexpected",
				message: unknownToMessage(Cause.squash(cause)),
				cleanupName: "cleanup-import-artifacts-on-unexpected-failure",
				cleanupPaths: cleanupPaths.length > 0 ? cleanupPaths : initialCleanupPaths,
			}),
		),
	);
});
