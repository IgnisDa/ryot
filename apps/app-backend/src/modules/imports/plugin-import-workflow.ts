import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import { SandboxExecutionGrants } from "@ryot/contract/modules/sandbox/schemas";
import { jsonValueSchema } from "@ryot/contract/modules/sandbox/wire";
import { genericImportWorkflowInputSchema } from "@ryot/sandbox-sdk/imports";
import { Cause, Effect, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import { WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { ImportSourceState } from "#lib/infrastructure/redis";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { withoutWorkflowParent } from "#lib/infrastructure/workflow";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { ImportRunJobData } from "./jobs";
import { markImportRunStarted } from "./runtime/import-run-status";
import { claimImportSourceState } from "./runtime/source-state-store";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";
import { createImportRunLifecycle } from "./runtime/workflow-helpers";

export const runPluginImportWorkflow = Effect.fn("runPluginImportWorkflow")(function* (
	payload: ImportRunJobData,
	executionId: string,
) {
	const sandbox = yield* SandboxExecutionService;
	const artifactOwnerExecutionId = `${executionId}-import`;
	const artifactReferenceExecutionId = `${executionId}-import-orchestrator`;
	const artifactDispatchReferenceExecutionId = `${executionId}-import-dispatch`;
	let uploadIntentIds: ReadonlyArray<string> = [];
	const { failRunAndCleanup, cleanupArtifactsBestEffort, cleanupUploadsBestEffort } =
		createImportRunLifecycle(payload, executionId);
	const releaseImportWorkflowPin = Activity.make({
		name: "release-import-workflow-pin",
		execute: sandbox.releaseWorkflowRegistration(artifactOwnerExecutionId).pipe(Effect.ignore),
	});
	const releaseImportArtifacts = Activity.make({
		error: ImportRunError,
		name: "release-import-artifacts",
		execute: Effect.gen(function* () {
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts.release(artifactOwnerExecutionId, artifactReferenceExecutionId);
		}).pipe(Effect.mapError(toWorkflowError)),
	});
	const retainImportDispatchArtifacts = Activity.make({
		error: ImportRunError,
		name: "retain-import-dispatch-artifacts",
		execute: Effect.gen(function* () {
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts.retain(artifactOwnerExecutionId, artifactDispatchReferenceExecutionId);
		}).pipe(Effect.mapError(toWorkflowError)),
	});
	const releaseImportDispatchArtifacts = Activity.make({
		error: ImportRunError,
		name: "release-import-dispatch-artifacts",
		execute: Effect.gen(function* () {
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts.release(artifactOwnerExecutionId, artifactDispatchReferenceExecutionId);
		}).pipe(Effect.mapError(toWorkflowError)),
	});

	const processWorkflow = Effect.gen(function* () {
		yield* Activity.make({
			error: ImportRunError,
			name: "mark-import-run-started",
			execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toWorkflowError)),
		});

		const sourceState = yield* Activity.make({
			error: ImportRunError,
			name: "claim-import-source-state",
			success: Schema.NullOr(ImportSourceState),
			execute: claimImportSourceState(payload.sourceStateId, executionId).pipe(
				Effect.mapError(toWorkflowError),
			),
		});
		if (sourceState === null) {
			return yield* new ImportRunError({ message: "Import source state is unavailable" });
		}
		uploadIntentIds = sourceState.uploadIntentIds;
		yield* Effect.annotateCurrentSpan({
			pluginSlug: sourceState.pluginSlug,
			workflowScriptId: sourceState.workflowScriptId,
		});
		const grants: SandboxExecutionGrants | undefined =
			Object.keys(sourceState.namedArtifactPaths).length > 0
				? { namedArtifactPaths: { ...sourceState.namedArtifactPaths } }
				: undefined;
		const pinnedGrants = grants
			? yield* Activity.make({
					error: ImportRunError,
					success: SandboxExecutionGrants,
					name: "materialize-import-artifacts",
					execute: Effect.gen(function* () {
						const artifacts = yield* SandboxArtifactStore;
						return yield* artifacts.materializeInputs(
							artifactOwnerExecutionId,
							artifactReferenceExecutionId,
							grants,
						);
					}).pipe(Effect.mapError(toWorkflowError)),
				})
			: undefined;
		const workflowInput = yield* Schema.encodeUnknownEffect(genericImportWorkflowInputSchema)({
			runId: payload.runId,
			source: sourceState.source,
			...(Object.keys(sourceState.sourcePayload).length > 0
				? { sourcePayload: sourceState.sourcePayload }
				: {}),
		}).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)),
			Effect.mapError(toWorkflowError),
		) satisfies Effect.Effect<JsonValue, ImportRunError>;

		yield* retainImportDispatchArtifacts;
		yield* sandbox
			.executeWorkflow({
				input: workflowInput,
				executionId: artifactOwnerExecutionId,
				scriptId: sourceState.workflowScriptId,
				...(pinnedGrants ? { grants: pinnedGrants } : {}),
				authority: { type: "user", userId: payload.userId },
			})
			.pipe(withoutWorkflowParent, Effect.mapError(toWorkflowError));

		yield* releaseImportDispatchArtifacts;
		yield* releaseImportArtifacts;
		yield* cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success");
		yield* cleanupUploadsBestEffort("cleanup-import-uploads-on-success", uploadIntentIds);
		return yield* Effect.void;
	});

	yield* processWorkflow.pipe(
		Effect.catchCause((cause) =>
			Effect.flatMap(WorkflowInstance, (instance) =>
				instance.suspended && Cause.hasInterruptsOnly(cause)
					? Effect.failCause(cause)
					: Effect.logError("plugin import workflow failed", cause).pipe(
							Effect.andThen(releaseImportWorkflowPin),
							Effect.andThen(releaseImportDispatchArtifacts),
							Effect.andThen(releaseImportArtifacts),
							Effect.andThen(
								failRunAndCleanup({
									uploadIntentIds,
									failureName: "fail-import-run-unexpected",
									cleanupName: "cleanup-import-artifacts-on-unexpected-failure",
									uploadCleanupName: "cleanup-import-uploads-on-unexpected-failure",
									reason: { code: "unexpected-failure", operation: "plugin-import" },
								}),
							),
						),
			),
		),
	);
});
