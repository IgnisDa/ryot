import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { jsonValueSchema } from "@ryot-app/contract/modules/sandbox/wire";
import { genericImportWorkflowInputSchema } from "@ryot-app/sandbox-sdk/imports";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Cause, DateTime, Effect, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { reconcileGenericIngestionBatch } from "./batch-results";
import { IngestionCaptures } from "./capture-service";
import { IngestionExecution } from "./execution-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import type { ImportRunJobData } from "./jobs";
import { ImportsRepository } from "./repository";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";

export const runPluginImportWorkflow = Effect.fn("runPluginImportWorkflow")(function* (
	payload: ImportRunJobData,
	executionId: string,
) {
	const accountGeneration = payload.command.accountGeneration;
	if (!accountGeneration) {
		return yield* new ImportRunError({ message: "Import account generation is missing" });
	}
	const scope = { accountGeneration, runId: payload.runId, userId: payload.userId };
	const receipts = yield* MutationReceipts.make;
	yield* admitWorkflow(receipts, ProcessImportRunWorkflow, accountGeneration, executionId).pipe(
		Effect.mapError(toWorkflowError),
	);
	const sandbox = yield* SandboxExecutionService;
	const sourceStates = yield* ImportSourceStateStore;
	const repository = yield* ImportsRepository;
	const execution = yield* IngestionExecution;
	const captures = yield* IngestionCaptures;
	const artifacts = yield* SandboxArtifactStore;
	const owner = `${executionId}-import`;
	const reference = `${executionId}-import-orchestrator`;
	const reconcile = (batch: Parameters<typeof reconcileGenericIngestionBatch>[1]) =>
		reconcileGenericIngestionBatch(scope, batch);
	const settle = (
		status: "completed" | "failed" | "cancelled",
		failureReason?: ImportRunFailureReason,
	) =>
		makeActivity({
			error: ImportRunError,
			success: Schema.Boolean,
			name: `settle-import:${status}`,
			execute: execution
				.settle({
					scope,
					status,
					reconcile,
					...(status === "failed"
						? {
								failureReason: failureReason ?? {
									operation: "plugin-import",
									code: "unexpected-failure" as const,
								},
							}
						: {}),
				})
				.pipe(Effect.mapError(toWorkflowError)),
		});
	const release = Effect.fnUntraced(function* () {
		yield* artifacts.release(owner, reference);
	});
	const initial = yield* repository.getIngestionRun(scope).pipe(Effect.mapError(toWorkflowError));
	if (!initial || ["completed", "failed", "cancelled", "expired"].includes(initial.status)) {
		yield* execution.cleanup(scope).pipe(Effect.mapError(toWorkflowError));
		return yield* Effect.void;
	}
	yield* Workflow.addFinalizer(() =>
		Effect.flatMap(WorkflowInstance, (instance) =>
			instance.interrupted
				? settle("cancelled").pipe(Effect.andThen(release()), Effect.catchCause(Effect.logError))
				: Effect.void,
		),
	);
	const process = Effect.gen(function* () {
		const run = yield* repository.getIngestionRun(scope);
		if (run?.status === "cancelling") {
			yield* settle("cancelled");
			return yield* Effect.void;
		}
		if (!run?.plan || !run.pins) {
			return yield* new ImportRunError({ message: "Import execution plan is not pinned" });
		}
		yield* makeActivity({
			error: ImportRunError,
			name: "start-ingestion",
			success: Schema.Boolean,
			execute: repository
				.startIngestion({ scope, startedAt: yield* DateTime.nowAsDate })
				.pipe(Effect.mapError(toWorkflowError)),
		});
		const started = yield* repository.getIngestionRun(scope);
		if (started?.status !== "running") {
			if (started?.status === "cancelling") {
				yield* settle("cancelled");
			}
			return yield* Effect.void;
		}
		yield* captures.recover(scope);
		const state = yield* sourceStates.materialize(scope);
		yield* artifacts.retain(owner, reference);
		const sourcePayloadHandle = yield* captures.stage({
			scope,
			outputIndex: 0,
			ownerExecutionId: owner,
			workflowExecutionId: owner,
			activityExecutionId: reference,
			bytes: new TextEncoder().encode(stableStringify(state.sourcePayload)),
		});
		const grants = yield* artifacts.materializeInputs(owner, reference, {
			namedArtifactPaths: state.namedArtifactPaths,
		});
		const input: JsonValue = yield* Schema.encodeUnknownEffect(genericImportWorkflowInputSchema)({
			plan: run.plan,
			sourcePayloadHandle,
			runId: payload.runId,
			source: state.source,
			command: payload.command,
		}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)));
		yield* sandbox.executeWorkflow({
			input,
			grants,
			lane: "background",
			executionId: owner,
			scriptId: state.workflowScriptId,
			pluginRevision: state.pluginRevision,
			subject: {
				type: "user",
				accountGeneration,
				userId: payload.userId,
				importRunId: payload.runId,
			},
		});
		const current = yield* repository.getIngestionRun(scope);
		if (current?.status === "cancelling") {
			yield* settle("cancelled");
		} else if (
			!current?.collectionSealed ||
			(yield* repository.listBatches(scope)).some(({ data }) => data.state !== "applied")
		) {
			yield* settle("failed");
		} else {
			yield* settle("completed");
		}
		yield* release();
		return yield* Effect.void;
	});
	yield* process.pipe(
		Effect.catchCause((cause) =>
			Effect.flatMap(WorkflowInstance, (instance) =>
				instance.suspended && Cause.hasInterruptsOnly(cause)
					? Effect.failCause(cause)
					: Effect.logError("plugin ingestion failed", cause).pipe(
							Effect.andThen(settle("failed", toWorkflowError(Cause.squash(cause)).reason)),
							Effect.andThen(release()),
						),
			),
		),
		Effect.mapError(toWorkflowError),
	);
	return yield* Effect.void;
});
