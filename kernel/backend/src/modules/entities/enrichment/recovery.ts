import { SandboxRunError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Effect, Layer, Option, Schema } from "effect";
import type { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { TranslateEntityWorkflow } from "#modules/entities/localization/entity-translation-workflow";
import { ProviderEntityPopulationWorkflow } from "#modules/entities/providers/provider-entity-population-workflow";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { ScriptExecutionService } from "#modules/scripts/executions/service";

import { EnrichmentRequests } from "./requests";

export class EnrichmentRecovery extends Context.Service<EnrichmentRecovery>()(
	"EnrichmentRecovery",
	{
		make: Effect.gen(function* () {
			const requests = yield* EnrichmentRequests;
			const engine = yield* WorkflowEngine;
			const receipts = yield* MutationReceipts.make;
			const sandbox = yield* ScriptExecutionService;
			const settle = Effect.fnUntraced(function* <A>(
				id: string,
				result: Workflow.Result<A, SandboxRunError>,
			) {
				if (result._tag !== "Complete") {
					return;
				}
				if (result.exit._tag === "Success") {
					yield* requests.update(id, { failureKind: null, state: "succeeded" });
				} else {
					const error = Cause.findErrorOption(result.exit.cause);
					yield* requests.update(id, {
						failureKind: Option.isSome(error) ? error.value.kind : "infrastructure",
						state: Cause.hasInterruptsOnly(result.exit.cause) ? "cancelled" : "failed",
					});
				}
			});
			const reconcile = Effect.fn("EnrichmentRecovery.reconcile")(function* () {
				for (const row of yield* requests.pending()) {
					yield* requests.observed(row.id);
					yield* Effect.gen(function* () {
						if (row.state === "succeeded" || row.state === "failed" || row.state === "cancelled") {
							yield* sandbox.releaseWorkflowRegistration(row.id);
							yield* requests.released(row.id);
							return;
						}
						const current =
							row.requesterUserId === null
								? null
								: yield* requests.account(UserId.make(row.requesterUserId));
						if (row.requesterUserId !== null && current?.token !== row.requesterGeneration) {
							yield* requests.update(row.id, { failureKind: null, state: "cancelled" });
							return;
						}
						const storedStatus = yield* requests.expiredExecutionStatus(row.id, row.workflowName);
						if (storedStatus === "succeeded" || storedStatus === "failed") {
							yield* requests.update(row.id, {
								state: storedStatus,
								failureKind: storedStatus === "failed" ? "infrastructure" : null,
							});
							return;
						}
						if (row.workflowName === ProviderEntityPopulationWorkflow._tag) {
							const result = yield* engine.poll(ProviderEntityPopulationWorkflow, row.id);
							if (Option.isSome(result)) {
								yield* settle(row.id, result.value);
							} else if (row.dispatchRoot) {
								const payload = yield* Schema.decodeUnknownEffect(
									ProviderEntityPopulationWorkflow.payloadSchema,
								)(row.payload).pipe(
									Effect.mapError(
										() =>
											new SandboxRunError({
												kind: "invalid-input",
												message: "Persisted population request is invalid",
											}),
									),
								);
								yield* dispatchAdmittedWorkflow(
									receipts,
									engine,
									ProviderEntityPopulationWorkflow,
									current,
									{ payload, discard: true, executionId: row.id },
									(admission) => admission,
									(execution) => execution,
								);
							}
						} else if (row.workflowName === TranslateEntityWorkflow._tag) {
							const result = yield* engine.poll(TranslateEntityWorkflow, row.id);
							if (Option.isSome(result)) {
								yield* settle(row.id, result.value);
							} else if (row.dispatchRoot) {
								const payload = yield* Schema.decodeUnknownEffect(
									TranslateEntityWorkflow.payloadSchema,
								)(row.payload).pipe(
									Effect.mapError(
										() =>
											new SandboxRunError({
												kind: "invalid-input",
												message: "Persisted translation request is invalid",
											}),
									),
								);
								yield* dispatchAdmittedWorkflow(
									receipts,
									engine,
									TranslateEntityWorkflow,
									current,
									{ payload, discard: true, executionId: row.id },
									(admission) => admission,
									(execution) => execution,
								);
							}
						} else {
							yield* requests.update(row.id, { state: "failed", failureKind: "invalid-input" });
						}
					}).pipe(
						Effect.catchTag("SandboxRunError", (error) =>
							error.kind === "invalid-input"
								? requests.update(row.id, { state: "failed", failureKind: error.kind })
								: Effect.logWarning("enrichment workflow dispatch failed", error),
						),
						Effect.catchCause((cause) =>
							Effect.logWarning("enrichment reconciliation failed", cause),
						),
					);
				}
				yield* requests.prune();
			});
			const run = reconcile().pipe(
				Effect.catchCause((cause) => Effect.logWarning("enrichment recovery failed", cause)),
				Effect.andThen(Effect.sleep("5 seconds")),
				Effect.forever,
			);
			return { run, reconcile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
	static readonly liveLayer = Layer.effectDiscard(
		Effect.flatMap(this, (recovery) => Effect.forkScoped(recovery.run)),
	).pipe(Layer.provideMerge(this.layer));
}
