import type {
	IngestionBatch,
	IngestionRun,
	IngestionScope,
	IngestionSummary,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import type { PluginIngestionRetirementPolicy } from "#modules/plugins/packages/ingestion-retirement";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import { DatabaseSession } from "#platform/db/session";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { interruptWorkflowAndWait, isExecutionSettled } from "#platform/workflow/interruption";

import { IngestionCaptures } from "./capture-service";
import { ImportsRepository } from "./repository";
import { ImportRunError } from "./runtime/workflow-errors";
import { ImportWorkflowPinning } from "./workflow-pinning";

export class IngestionExecution extends Context.Service<IngestionExecution>()(
	"@ryot-app/kernel-backend/modules/imports/execution-service/IngestionExecution",
	{
		make: Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			const captures = yield* IngestionCaptures;
			const pins = yield* ImportWorkflowPinning;
			const database = yield* DatabaseSession;
			const engine = yield* WorkflowEngine;
			const notifications = yield* WorkflowExecutionNotifications;
			// A plugin's chunks are written by its script, which only exists once a chunk has started.
			const chunkWriter = Effect.fnUntraced(function* (
				scope: IngestionScope,
				run: Pick<IngestionRun, "pins" | "pluginInstallationId">,
			) {
				return run.pins && run.pluginInstallationId !== null && (yield* repository.hasStartedBatch(scope))
					? run.pins.executionId
					: null;
			});
			const canCleanup = Effect.fn("IngestionExecution.canCleanup")(function* (
				scope: IngestionScope,
			) {
				const run = yield* repository.getIngestionRunControl(scope);
				if (run?.failureReason?.code !== "package-identity-conflict") {
					return true;
				}
				const instance = yield* Effect.serviceOption(WorkflowInstance);
				const currentExecutionId = Option.isSome(instance) ? instance.value.executionId : null;
				const writer = yield* chunkWriter(scope, run);
				const owners = [
					{
						executionId: scope.runId,
						workflowName:
							run.integrationId === null
								? "ProcessImportRunWorkflow"
								: "ProcessIntegrationRunWorkflow",
					},
					...(writer ? [{ executionId: writer, workflowName: ScriptExecutionWorkflow._tag }] : []),
				];
				for (const owner of owners) {
					if (
						owner.executionId !== currentExecutionId &&
						!(yield* isExecutionSettled(owner).pipe(Effect.provideService(WorkflowEngine, engine)))
					) {
						return false;
					}
				}
				return true;
			});
			const cleanup = Effect.fn("IngestionExecution.cleanup")(function* (scope: IngestionScope) {
				const run = yield* repository.getIngestionRunControl(scope);
				if (!run || !["failed", "expired", "completed", "cancelled"].includes(run.status)) {
					return;
				}
				if (!(yield* canCleanup(scope))) {
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
				failureReason?: ImportRunFailureReason;
				status: "failed" | "completed" | "cancelled";
				retirementPolicy?: PluginIngestionRetirementPolicy;
				reconcile: (batch: IngestionBatch) => Effect.Effect<IngestionSummary, E, R>;
				confirm?: (
					batch: IngestionBatch,
				) => Effect.Effect<void, ConfirmationError, ConfirmationServices>;
			}) {
				const run = yield* repository.getIngestionRunControl(input.scope);
				if (!run) {
					return false;
				}
				const policy: PluginIngestionRetirementPolicy =
					input.retirementPolicy ??
					(run.failureReason?.code === "package-identity-conflict"
						? {
								kind: "quarantine",
								reason: { ...run.failureReason, code: "package-identity-conflict" },
							}
						: { kind: "removal" });
				if (["failed", "expired", "completed", "cancelled"].includes(run.status)) {
					if (policy.kind === "removal") {
						yield* cleanup(input.scope);
					}
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
					const writer = yield* chunkWriter(input.scope, run);
					if (writer) {
						yield* policy.kind === "quarantine"
							? engine.interrupt(ScriptExecutionWorkflow, writer)
							: interruptWorkflowAndWait(ScriptExecutionWorkflow, writer, {
									requireReply: true,
								}).pipe(
									Effect.provideService(WorkflowEngine, engine),
									Effect.provideService(WorkflowExecutionNotifications, notifications),
								);
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
							...(policy.kind === "quarantine" ? { failureReason: policy.reason } : {}),
						});
					}),
				);
				if (
					!settled &&
					(yield* repository.getIngestionRunControl(input.scope))?.status === "cancelling"
				) {
					yield* repository.settleIngestion({
						scope: input.scope,
						status: "cancelled",
						finishedAt: yield* DateTime.nowAsDate,
						...(policy.kind === "quarantine" ? { failureReason: policy.reason } : {}),
					});
				}
				if (policy.kind === "removal") {
					yield* cleanup(input.scope);
				}
				return settled;
			});
			const deleteReport = Effect.fn("IngestionExecution.deleteReport")(function* (
				scope: IngestionScope,
			) {
				if (!(yield* canCleanup(scope))) {
					return yield* new ImportRunError({ message: "Ingestion execution is still settling" });
				}
				yield* cleanup(scope);
				return yield* database.transaction(
					Effect.gen(function* () {
						yield* repository.purgePayloadReservations(scope);
						return yield* repository.deleteIngestionReport(scope);
					}),
				);
			});
			const retire = Effect.fn("IngestionExecution.retire")(function* (input: {
				runId?: IngestionScope["runId"];
				userId: IngestionScope["userId"];
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
				const run = yield* repository.getIngestionRunControl(scope);
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
