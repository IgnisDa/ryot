import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

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

it.effect(
	"joins the batch owner and reconciles committed work before cancellation and terminal cleanup",
	() =>
		Effect.gen(function* () {
			const events: string[] = [];
			let run = ingestionTestRun({ status: "cancelling" });
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
					settleIngestion: (input) =>
						Effect.sync(() => {
							events.push(input.status);
							run = { ...run, status: input.status };
							return true;
						}),
					finishActivities: () =>
						Effect.sync(() => {
							expect(applied).toBe(true);
							events.push("close-activities");
							return "cancelled" as const;
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
						reconcile: () =>
							Effect.sync(() => {
								expect(events).toEqual(["interrupt", "waiting", "join"]);
								events.push("reconcile");
								applied = true;
								return [];
							}),
						confirm: () =>
							Effect.sync(() => {
								expect(applied).toBe(true);
								expect(run.status).toBe("cancelling");
								expect(run.pins).not.toBeNull();
								events.push("confirm");
							}),
					})
					.pipe(Effect.forkChild);
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
