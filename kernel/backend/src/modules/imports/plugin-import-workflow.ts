import { ImportRunStatus } from "@ryot-app/contract/modules/imports/schemas";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { SandboxExecutionGrants } from "@ryot-app/contract/modules/sandbox/schemas";
import { jsonValueSchema } from "@ryot-app/contract/modules/sandbox/wire";
import { genericImportWorkflowInputSchema } from "@ryot-app/sandbox-sdk/imports";
import { Cause, DateTime, Effect, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { ImportSourceState } from "#lib/infrastructure/redis";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import { MutationReceipts } from "#modules/mutations/receipts";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { ProcessImportRunWorkflow } from "./import-run-workflow";
import type { ImportRunJobData } from "./jobs";
import { markImportRunStarted } from "./runtime/import-run-status";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";
import { createImportRunLifecycle } from "./runtime/workflow-helpers";
import { ImportsService } from "./service";

export const runPluginImportWorkflow = Effect.fn("runPluginImportWorkflow")(function* (
	payload: ImportRunJobData,
	executionId: string,
) {
	const accountGeneration = payload.command.accountGeneration;
	if (accountGeneration === null) {
		return yield* new ImportRunError({ message: "Import account generation is missing" });
	}
	const receipts = yield* MutationReceipts.make;
	yield* receipts
		.registerWorkflow(accountGeneration, ProcessImportRunWorkflow._tag, executionId)
		.pipe(Effect.mapError(toWorkflowError));
	const sandbox = yield* SandboxExecutionService;
	const artifactOwnerExecutionId = `${executionId}-import`;
	const artifactReferenceExecutionId = `${executionId}-import-orchestrator`;
	const artifactDispatchReferenceExecutionId = `${executionId}-import-dispatch`;
	let uploadIntentIds: ReadonlyArray<string> = payload.uploadIntentIds;
	const { failRunAndCleanup, cleanupUploadsBestEffort, cleanupArtifactsBestEffort } =
		createImportRunLifecycle(payload, executionId);
	const releaseImportWorkflowPin = makeActivity({
		name: "release-import-workflow-pin",
		execute: sandbox.releaseWorkflowRegistration(artifactOwnerExecutionId).pipe(Effect.ignore),
	});
	const releaseImportArtifacts = makeActivity({
		error: ImportRunError,
		name: "release-import-artifacts",
		execute: Effect.gen(function* () {
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts.release(artifactOwnerExecutionId, artifactReferenceExecutionId);
		}).pipe(Effect.mapError(toWorkflowError)),
	});
	const retainImportDispatchArtifacts = makeActivity({
		error: ImportRunError,
		name: "retain-import-dispatch-artifacts",
		execute: Effect.gen(function* () {
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts.retain(artifactOwnerExecutionId, artifactDispatchReferenceExecutionId);
		}).pipe(Effect.mapError(toWorkflowError)),
	});
	const releaseImportDispatchArtifacts = makeActivity({
		error: ImportRunError,
		name: "release-import-dispatch-artifacts",
		execute: Effect.gen(function* () {
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts.release(artifactOwnerExecutionId, artifactDispatchReferenceExecutionId);
		}).pipe(Effect.mapError(toWorkflowError)),
	});
	const completeCancellation = Effect.fn("completeImportRunCancellation")(function* () {
		yield* releaseImportWorkflowPin;
		yield* releaseImportDispatchArtifacts;
		yield* releaseImportArtifacts;
		yield* cleanupArtifactsBestEffort("cleanup-import-artifacts-on-cancellation");
		yield* cleanupUploadsBestEffort("cleanup-import-uploads-on-cancellation", uploadIntentIds);
		yield* makeActivity({
			error: ImportRunError,
			name: "finish-import-run-cancelled",
			execute: Effect.gen(function* () {
				const imports = yield* ImportsService;
				const finishedAt = yield* DateTime.nowAsDate;
				yield* imports.finishCancelled({ finishedAt, runId: payload.runId });
			}).pipe(Effect.mapError(toWorkflowError)),
		});
	});
	yield* Workflow.addFinalizer(() =>
		Effect.flatMap(WorkflowInstance, (instance) =>
			instance.interrupted
				? completeCancellation().pipe(
						Effect.catchCause((cause) =>
							Effect.logError("import cancellation cleanup failed", cause),
						),
					)
				: Effect.void,
		),
	);

	const processWorkflow = Effect.gen(function* () {
		const start = yield* makeActivity({
			error: ImportRunError,
			name: "mark-import-run-started",
			success: Schema.Literals(["started", "cancellation-requested", "preserved"]),
			execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toWorkflowError)),
		});
		if (start === "cancellation-requested") {
			yield* completeCancellation();
			return;
		}
		if (start === "preserved") {
			return;
		}

		const sourceState = yield* makeActivity({
			error: ImportRunError,
			name: "claim-import-source-state",
			success: Schema.NullOr(ImportSourceState),
			execute: Effect.flatMap(ImportSourceStateStore, (sourceStates) =>
				sourceStates.claim(payload.sourceStateId, executionId),
			).pipe(Effect.mapError(toWorkflowError)),
		}).pipe(
			Effect.filterOrFail(
				(state): state is ImportSourceState => state !== null,
				() => new ImportRunError({ message: "Import source state is unavailable" }),
			),
		);
		uploadIntentIds = sourceState.uploadIntentIds;
		yield* Effect.annotateCurrentSpan({
			pluginId: sourceState.pluginId,
			workflowScriptId: sourceState.workflowScriptId,
			pluginInstallationId: sourceState.pluginInstallationId,
		});
		const grants: SandboxExecutionGrants | undefined =
			Object.keys(sourceState.namedArtifactPaths).length > 0
				? { namedArtifactPaths: { ...sourceState.namedArtifactPaths } }
				: undefined;
		const pinnedGrants = grants
			? yield* makeActivity({
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
			command: payload.command,
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
				pluginRevision: sourceState.pluginRevision,
				...(pinnedGrants ? { grants: pinnedGrants } : {}),
				subject: { type: "user", accountGeneration, userId: payload.userId },
			})
			.pipe(Effect.mapError(toWorkflowError));

		const runStatus = yield* makeActivity({
			error: ImportRunError,
			name: "settle-import-run-after-plugin",
			success: Schema.NullOr(ImportRunStatus),
			execute: Effect.gen(function* () {
				const imports = yield* ImportsService;
				const run = yield* imports.getRunControlForUser({
					runId: payload.runId,
					userId: payload.userId,
				});
				if (run?.status === "running") {
					const finishedAt = yield* DateTime.nowAsDate;
					yield* imports.finishFailed({
						finishedAt,
						runId: payload.runId,
						failureReason: { code: "unexpected-failure", operation: "generic-import-finalization" },
					});
					return "failed" as const;
				}
				return run?.status ?? null;
			}).pipe(Effect.mapError(toWorkflowError)),
		});
		if (runStatus === "cancelling") {
			yield* completeCancellation();
			return;
		}

		yield* releaseImportDispatchArtifacts;
		yield* releaseImportArtifacts;
		yield* cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success");
		yield* cleanupUploadsBestEffort("cleanup-import-uploads-on-success", uploadIntentIds);
		yield* Effect.void;
	});

	yield* processWorkflow.pipe(
		Effect.catchCause((cause) =>
			Effect.flatMap(WorkflowInstance, (instance) => {
				const interruptedOnly = Cause.hasInterruptsOnly(cause);
				if (interruptedOnly && instance.suspended) {
					return Effect.failCause(cause);
				}
				return Effect.logError("plugin import workflow failed", cause).pipe(
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
				);
			}),
		),
	);
	return yield* Effect.void;
});
