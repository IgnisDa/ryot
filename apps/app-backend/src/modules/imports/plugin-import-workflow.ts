import { unknownToMessage } from "@ryot/contract/errors";
import { SandboxExecutionGrants } from "@ryot/contract/modules/sandbox/schemas";
import { genericImportWorkflowInputSchema } from "@ryot/sandbox-sdk/imports";
import { jsonValueSchema, type JsonValue } from "@ryot/sandbox-sdk/wire";
import { Cause, Effect, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import { WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { withoutWorkflowParent } from "#lib/infrastructure/workflow";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { ImportRunJobData } from "./jobs";
import { markImportRunStarted } from "./runtime/import-run-status";
import { loadImportSourcePayload } from "./runtime/source-payload-store";
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
	const namedArtifactPaths: Record<string, string> = {};
	let artifactPath: string | undefined;
	if (payload.namedArtifactPaths) {
		for (const [key, suppliedPath] of Object.entries(payload.namedArtifactPaths)) {
			namedArtifactPaths[key] = suppliedPath;
		}
	} else if (payload.filePath) {
		artifactPath = payload.filePath;
	}
	let grants: SandboxExecutionGrants | undefined;
	if (artifactPath) {
		grants = { artifactPath };
	} else if (Object.keys(namedArtifactPaths).length > 0) {
		grants = { namedArtifactPaths };
	}
	const { failRunAndCleanup, cleanupArtifactsBestEffort, cleanupUploadsBestEffort } =
		createImportRunLifecycle(payload);
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
			source: payload.source,
			...(sourcePayload ? { sourcePayload } : {}),
		}).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)),
			Effect.mapError(toWorkflowError),
		) satisfies Effect.Effect<JsonValue, ImportRunError>;

		yield* retainImportDispatchArtifacts;
		yield* sandbox
			.executeWorkflow({
				input: workflowInput,
				scriptId: payload.workflowScriptId,
				executionId: artifactOwnerExecutionId,
				...(pinnedGrants ? { grants: pinnedGrants } : {}),
				authority: { type: "user", userId: payload.userId },
			})
			.pipe(withoutWorkflowParent, Effect.mapError(toWorkflowError));

		yield* releaseImportDispatchArtifacts;
		yield* releaseImportArtifacts;
		yield* cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success");
		yield* cleanupUploadsBestEffort("cleanup-import-uploads-on-success");
	});

	yield* processWorkflow.pipe(
		Effect.catchCause((cause) =>
			Effect.flatMap(WorkflowInstance, (instance) =>
				instance.suspended && Cause.hasInterruptsOnly(cause)
					? Effect.failCause(cause)
					: releaseImportWorkflowPin.pipe(
							Effect.andThen(releaseImportDispatchArtifacts),
							Effect.andThen(releaseImportArtifacts),
							Effect.andThen(
								failRunAndCleanup({
									failureName: "fail-import-run-unexpected",
									message: unknownToMessage(Cause.squash(cause)),
									cleanupName: "cleanup-import-artifacts-on-unexpected-failure",
									uploadCleanupName: "cleanup-import-uploads-on-unexpected-failure",
								}),
							),
						),
			),
		),
	);
});
