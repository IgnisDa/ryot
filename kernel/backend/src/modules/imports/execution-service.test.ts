import { expect, it } from "@effect/vitest";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { Deferred, Effect, Exit, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { WorkflowExecutionNotifications } from "#lib/infrastructure/workflow-execution-notifications";
import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";

import { IngestionCaptures } from "./capture-service";
import { IngestionExecution } from "./execution-service";
import { ProcessGenericImportChunksWorkflow } from "./generic-import-workflow";
import {
	ingestionTestDatabase,
	ingestionTestRun,
	ingestionTestScope,
} from "./ingestion.test-support";
import { ImportsRepository } from "./repository";
import { ImportWorkflowPinning } from "./workflow-pinning";

for (const mode of ["removal", "quarantine"] as const) {
	it.effect(`${mode} reconciles committed receipts with its retained-work cleanup policy`, () =>
		Effect.gen(function* () {
			const events: string[] = [];
			const reason = {
				installationId: "installation-1",
				code: "package-identity-conflict",
				pluginId: PluginId.make("plugin-1"),
			} as const;
			let run = ingestionTestRun({
				status: "cancelling",
				...(mode === "quarantine" ? { failureReason: reason } : {}),
			});
			let applied = false;
			let polled = false;
			const waiting = yield* Deferred.make<void>();
			const batch = {
				ordinal: 0,
				id: "batch",
				summary: [],
				captureId: "capture",
				state: "applying" as const,
				inputFingerprint: "fingerprint",
			};
			const dependencies = Layer.mergeAll(
				WorkflowExecutionNotifications.layer,
				ingestionTestDatabase(),
				Layer.succeed(AdmittedWorkflowCatalogue, [ProcessGenericImportChunksWorkflow]),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						interrupt: () =>
							Effect.sync(() => {
								events.push("interrupt");
							}),
						poll: () =>
							Effect.gen(function* () {
								if (!polled) {
									polled = true;
									events.push("waiting");
									yield* Deferred.succeed(waiting, undefined);
									return Option.none();
								}
								events.push("join");
								return Option.some(new Workflow.Complete({ exit: Exit.void }));
							}),
					}),
				),
				Layer.mock(ImportsRepository)({
					getIngestionRun: () => Effect.sync(() => run),
					listBatches: () => Effect.succeed([{ data: batch }]),
					listBatchExecutions: () =>
						Effect.succeed([
							{ executionId: "batch-owner", workflowName: ProcessGenericImportChunksWorkflow._tag },
						]),
					releaseIngestionPins: () =>
						Effect.sync(() => {
							events.push("clear-pins");
							run = { ...run, pins: null };
							return true;
						}),
					finishActivities: () =>
						Effect.sync(() => {
							expect(applied).toBe(true);
							events.push("close-activities");
							return "cancelled" as const;
						}),
					settleIngestion: (input) =>
						Effect.sync(() => {
							if (mode === "quarantine") {
								expect(input.failureReason).toEqual(reason);
							}
							events.push(input.status);
							run = { ...run, status: input.status };
							return true;
						}),
				}),
				Layer.mock(IngestionCaptures)({
					stopWrites: () => Effect.void,
					cleanup: () =>
						Effect.sync(() => {
							expect(run.status).toBe("cancelled");
							events.push("delete-bytes");
						}),
				}),
				Layer.mock(ImportWorkflowPinning)({
					release: (executionId) =>
						Effect.sync(() => {
							expect(executionId).toBe("run-1-import");
							events.push("release-pin");
						}),
				}),
			);
			yield* Effect.gen(function* () {
				const execution = yield* IngestionExecution;
				const settlement = yield* execution
					.settle({
						status: "completed",
						scope: ingestionTestScope,
						retirementPolicy:
							mode === "quarantine" ? { reason, kind: "quarantine" } : { kind: "removal" },
						confirm: () =>
							Effect.sync(() => {
								expect(applied).toBe(true);
								expect(run.status).toBe("cancelling");
								expect(run.pins).not.toBeNull();
								events.push("confirm");
							}),
						reconcile: () =>
							Effect.sync(() => {
								expect(events).toEqual(
									mode === "quarantine" ? ["interrupt"] : ["interrupt", "waiting", "join"],
								);
								events.push("reconcile");
								applied = true;
								return [];
							}),
					})
					.pipe(Effect.forkChild);
				if (mode === "removal") {
					yield* Deferred.await(waiting);
					expect(applied).toBe(false);
					yield* TestClock.adjust("1 second");
					expect(yield* Fiber.join(settlement)).toBe(true);
					expect(events).toEqual([
						"interrupt",
						"waiting",
						"join",
						"reconcile",
						"confirm",
						"close-activities",
						"cancelled",
						"delete-bytes",
						"release-pin",
						"clear-pins",
					]);
				} else {
					expect(yield* Fiber.join(settlement)).toBe(true);
					yield* execution.cleanup(ingestionTestScope);
					expect(events).toEqual([
						"interrupt",
						"reconcile",
						"confirm",
						"close-activities",
						"cancelled",
					]);
					expect(run.pins).not.toBeNull();
				}
			}).pipe(
				Effect.provideContext(
					yield* Layer.build(
						Layer.effect(IngestionExecution, IngestionExecution.make).pipe(
							Layer.provide(dependencies),
						),
					),
				),
			);
		}),
	);
}
