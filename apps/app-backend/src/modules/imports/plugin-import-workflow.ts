import { Activity } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Effect } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import type { RegisteredImportSource } from "#modules/plugins/import-source-catalog";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { ImportRunJobData } from "./jobs";
import { resolveImportPath } from "./runtime/import-files";
import { markImportRunStarted } from "./runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";
import { createImportRunLifecycle } from "./runtime/workflow-helpers";

export const runPluginImportWorkflow = Effect.fn("runPluginImportWorkflow")(function* (
	payload: ImportRunJobData,
	executionId: string,
	source: RegisteredImportSource,
) {
	const config = yield* AppConfig;
	const sandbox = yield* SandboxExecutionService;
	const cleanupPaths = payload.filePath
		? yield* resolveImportPath(payload.filePath, config.tmpDir)
		: [];
	const { failRunAndCleanup, cleanupArtifactsBestEffort } = createImportRunLifecycle(payload);

	const processWorkflow = Effect.gen(function* () {
		yield* Activity.make({
			error: ImportRunError,
			name: "mark-import-run-started",
			execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toWorkflowError)),
		});

		const scriptId = yield* sandbox
			.resolveWorkflowScript({
				executionId,
				pluginSlug: source.pluginSlug,
				workflowSlug: source.workflowSlug,
			})
			.pipe(Effect.mapError(toWorkflowError));

		yield* sandbox
			.executeWorkflow({
				scriptId,
				executionId: `${executionId}-import`,
				authority: { type: "user", userId: payload.userId },
				input: {
					runId: payload.runId,
					userId: payload.userId,
					...(payload.filePath ? { artifactPath: payload.filePath } : {}),
					...(payload.sourcePayloadKey ? { sourcePayloadRef: payload.sourcePayloadKey } : {}),
				},
			})
			.pipe(Effect.mapError(toWorkflowError));

		yield* cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success", cleanupPaths);
	});

	yield* processWorkflow.pipe(
		Effect.catchAllCause((cause) =>
			failRunAndCleanup({
				cleanupPaths,
				failureName: "fail-import-run-unexpected",
				message: unknownToMessage(Cause.squash(cause)),
				cleanupName: "cleanup-import-artifacts-on-unexpected-failure",
			}),
		),
	);
});
