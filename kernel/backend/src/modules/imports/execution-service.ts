import type {
	IngestionBatch,
	IngestionScope,
	IngestionSummary,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";

import { IngestionCaptures } from "./capture-service";
import { ImportsRepository } from "./repository";
import { ImportRunError } from "./runtime/workflow-errors";
import { ImportWorkflowPinning } from "./workflow-pinning";

export class IngestionExecution extends Context.Service<IngestionExecution>()(
	"IngestionExecution",
	{
		make: Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			const captures = yield* IngestionCaptures;
			const pins = yield* ImportWorkflowPinning;
			const database = yield* DatabaseSession;
			const engine = yield* WorkflowEngine;
			const catalogue = yield* AdmittedWorkflowCatalogue;
			const cleanup = Effect.fn("IngestionExecution.cleanup")(function* (scope: IngestionScope) {
				const run = yield* repository.getIngestionRun(scope);
				if (!run || !["completed", "failed", "cancelled", "expired"].includes(run.status)) {
					return;
				}
				yield* captures.cleanup(scope);
				if (run.pins?.pluginRevisionId) {
					yield* pins.release(run.pins.executionId);
				}
				yield* repository.releaseIngestionPins(scope);
			});
			const settle = Effect.fn("IngestionExecution.settle")(function* <
				E,
				R,
				ConfirmationError = never,
				ConfirmationServices = never,
			>(input: {
				scope: IngestionScope;
				status: "completed" | "failed" | "cancelled";
				failureReason?: ImportRunFailureReason;
				reconcile: (batch: IngestionBatch) => Effect.Effect<IngestionSummary, E, R>;
				confirm?: (
					batch: IngestionBatch,
				) => Effect.Effect<void, ConfirmationError, ConfirmationServices>;
			}) {
				const run = yield* repository.getIngestionRun(input.scope);
				if (!run) {
					return false;
				}
				if (["completed", "failed", "cancelled", "expired"].includes(run.status)) {
					yield* cleanup(input.scope);
					return false;
				}
				const requestedStatus =
					input.status === "completed" &&
					run.status !== "cancelling" &&
					!(yield* repository.isIngestionApplied(input.scope))
						? "failed"
						: input.status;
				if (run.status === "cancelling" || requestedStatus !== "completed") {
					yield* captures.stopWrites(input.scope);
					for (const owner of yield* repository.listBatchExecutions(input.scope)) {
						if (owner.executionId === input.scope.runId) {
							continue;
						}
						const workflow = catalogue.find((value) => value._tag === owner.workflowName);
						if (!workflow) {
							return yield* new ImportRunError({
								message: "Ingestion batch owner is not registered",
							});
						}
						const completion = Workflow.make(workflow._tag, {
							error: Schema.Unknown,
							success: Schema.Unknown,
							payload: Schema.Struct({}),
							idempotencyKey: () => owner.executionId,
						});
						yield* engine.interrupt(workflow, owner.executionId);
						for (;;) {
							const result = yield* engine.poll(completion, owner.executionId);
							if (Option.isSome(result) && result.value._tag === "Complete") {
								break;
							}
							yield* Effect.sleep("100 millis");
						}
					}
				}
				for (const { data } of yield* repository.listBatches(input.scope)) {
					if (data.state !== "applied") {
						yield* input.reconcile(data);
					}
					if (input.confirm) {
						yield* input.confirm(data);
					}
				}
				const finishedAt = yield* DateTime.nowAsDate;
				const settled = yield* database.transaction(
					Effect.gen(function* () {
						const status = yield* repository.finishActivities(input.scope, requestedStatus);
						if (status === null) {
							return false;
						}
						return yield* repository.settleIngestion({
							status,
							finishedAt,
							scope: input.scope,
							...(status === "failed"
								? {
										failureReason: input.failureReason ?? {
											operation: "ingestion-completion",
											code: "unexpected-failure" as const,
										},
									}
								: {}),
						});
					}),
				);
				if (!settled && (yield* repository.getIngestionRun(input.scope))?.status === "cancelling") {
					yield* repository.settleIngestion({
						scope: input.scope,
						status: "cancelled",
						finishedAt: yield* DateTime.nowAsDate,
					});
				}
				yield* cleanup(input.scope);
				return settled;
			});
			const deleteReport = Effect.fn("IngestionExecution.deleteReport")(function* (
				scope: IngestionScope,
			) {
				yield* cleanup(scope);
				return yield* database.transaction(
					Effect.gen(function* () {
						yield* repository.purgePayloadReservations(scope);
						return yield* repository.deleteIngestionReport(scope);
					}),
				);
			});
			const retire = Effect.fn("IngestionExecution.retire")(function* (input: {
				userId: IngestionScope["userId"];
				runId?: IngestionScope["runId"];
			}) {
				for (const { pins: retained } of yield* repository.listCleanupPins(input)) {
					if (retained?.pluginRevisionId) {
						yield* pins.release(retained.executionId);
					}
				}
				yield* captures.retire(input);
			});
			const abortAdmission = Effect.fn("IngestionExecution.abortAdmission")(function* (
				scope: IngestionScope,
			) {
				yield* repository.claimAdmissionAbort(scope);
				const run = yield* repository.getIngestionRun(scope);
				if (!run || run.plan || run.status !== "cancelling") {
					return false;
				}
				yield* pins.release(run.pins?.executionId ?? `${scope.runId}-import`);
				yield* captures.retire(scope);
				return yield* database.transaction(repository.abortAdmission(scope));
			});
			return { settle, retire, cleanup, deleteReport, abortAdmission };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(ImportsRepository.layer, IngestionCaptures.layer)),
	);
}
