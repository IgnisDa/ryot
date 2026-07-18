import { unknownToMessage } from "@ryot/contract/errors";
import type { SandboxExecutionGrants } from "@ryot/contract/modules/sandbox/schemas";
import { genericImportWorkflowInputSchema } from "@ryot/sandbox-sdk/imports";
import { jsonValueSchema, type JsonValue } from "@ryot/sandbox-sdk/wire";
import { Cause, Effect, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";

import { AppConfig } from "#lib/infrastructure/config/service";
import { withoutWorkflowParent } from "#lib/infrastructure/workflow";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { ImportRunJobData } from "./jobs";
import { resolveImportPath } from "./runtime/import-files";
import { markImportRunStarted } from "./runtime/import-run-status";
import { loadImportSourcePayload } from "./runtime/source-payload-store";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";
import { createImportRunLifecycle } from "./runtime/workflow-helpers";

export const runPluginImportWorkflow = Effect.fn("runPluginImportWorkflow")(function* (
	payload: ImportRunJobData,
	executionId: string,
) {
	const config = yield* AppConfig;
	const sandbox = yield* SandboxExecutionService;
	const namedArtifactPaths: Record<string, string> = {};
	const cleanupPaths: string[] = [];
	if (payload.namedArtifactPaths) {
		for (const [key, suppliedPath] of Object.entries(payload.namedArtifactPaths)) {
			const [resolvedPath] = yield* resolveImportPath(suppliedPath, config.tmpDir);
			if (resolvedPath) {
				namedArtifactPaths[key] = resolvedPath;
				cleanupPaths.push(resolvedPath);
			}
		}
	} else if (payload.filePath) {
		cleanupPaths.push(...(yield* resolveImportPath(payload.filePath, config.tmpDir)));
	}
	const artifactPath = payload.namedArtifactPaths ? undefined : cleanupPaths[0];
	let grants: SandboxExecutionGrants | undefined;
	if (artifactPath) {
		grants = { artifactPath };
	} else if (Object.keys(namedArtifactPaths).length > 0) {
		grants = { namedArtifactPaths };
	}
	const { failRunAndCleanup, cleanupArtifactsBestEffort, cleanupHarvestedDirectoriesBestEffort } =
		createImportRunLifecycle(payload);
	const releaseImportWorkflowPin = Activity.make({
		name: "release-import-workflow-pin",
		execute: sandbox.releaseWorkflowRegistration(`${executionId}-import`).pipe(Effect.ignore),
	});

	const processWorkflow = Effect.gen(function* () {
		yield* Activity.make({
			error: ImportRunError,
			name: "mark-import-run-started",
			execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toWorkflowError)),
		});

		const storedSourcePayload = payload.sourcePayloadKey
			? yield* Activity.make({
					error: ImportRunError,
					name: "load-import-source-payload",
					success: Schema.NullOr(Schema.Record(Schema.String, jsonValueSchema)),
					execute: loadImportSourcePayload(payload.sourcePayloadKey).pipe(
						Effect.mapError(toWorkflowError),
					),
				})
			: null;
		const sourcePayload = payload.sourcePayload ?? storedSourcePayload ?? undefined;
		const workflowInput = yield* Schema.encodeUnknownEffect(genericImportWorkflowInputSchema)({
			runId: payload.runId,
			source: payload.source,
			...(sourcePayload ? { sourcePayload } : {}),
		}).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)),
			Effect.mapError(toWorkflowError),
		) satisfies Effect.Effect<JsonValue, ImportRunError>;

		yield* sandbox
			.executeWorkflow({
				scriptId: payload.workflowScriptId,
				input: workflowInput,
				...(grants ? { grants } : {}),
				executionId: `${executionId}-import`,
				authority: { type: "user", userId: payload.userId },
			})
			.pipe(withoutWorkflowParent, Effect.mapError(toWorkflowError));

		yield* cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success", cleanupPaths);
	});

	yield* processWorkflow.pipe(
		Effect.catchCause((cause) =>
			Cause.hasInterruptsOnly(cause)
				? Effect.failCause(cause)
				: releaseImportWorkflowPin.pipe(
						Effect.andThen(
							cleanupHarvestedDirectoriesBestEffort(
								"cleanup-import-harvest-on-failure",
								`${executionId}-import-activity-`,
							),
						),
						Effect.andThen(
							failRunAndCleanup({
								cleanupPaths,
								failureName: "fail-import-run-unexpected",
								message: unknownToMessage(Cause.squash(cause)),
								cleanupName: "cleanup-import-artifacts-on-unexpected-failure",
							}),
						),
					),
		),
	);
});
