import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

import { automationAttemptIdentity } from "./attempt-repository";
import {
	AUTOMATION_IMMEDIATE_CONCURRENCY,
	AUTOMATION_IMMEDIATE_TIMEOUT_MS,
	AutomationExecutionOperations,
	AutomationExecutionOperationsLive,
} from "./execution";
import {
	AUTOMATION_RECONCILIATION_BATCH_SIZE,
	AutomationReconciliation,
	AutomationReconciliationOperations,
	automationsFrequentTask,
} from "./reconciliation";
import { AutomationRunRepository } from "./run-repository";
import { AutomationRunWorkflowPayload } from "./run-workflow";

const candidate = (id: string, attemptCount = 0) => ({
	attemptCount,
	id: AutomationRunId.make(id),
});
const layer = (operations: AutomationReconciliationOperations["Service"]) =>
	AutomationReconciliation.layer.pipe(
		Layer.provide(Layer.succeed(AutomationReconciliationOperations, operations)),
	);
const reconcile = Effect.flatMap(AutomationReconciliation, (service) => service.reconcile());

it.effect(
	"submits missed initial runs and due retries with the same deterministic ID on replay",
	() =>
		Effect.gen(function* () {
			const reads: Array<{ now: Date; limit: number }> = [];
			const submissions: Array<{
				payload: AutomationRunWorkflowPayload;
				executionId: string;
				discard: boolean;
			}> = [];
			const engine = makeWorkflowEngine({
				execute: (_workflow, options) =>
					Effect.gen(function* () {
						const payload = yield* Schema.decodeUnknownEffect(AutomationRunWorkflowPayload)(
							options.payload,
						);
						submissions.push({
							payload,
							executionId: options.executionId,
							discard: options.discard === true,
						});
					}),
			});
			const now = DateTime.toDate(yield* DateTime.now);
			yield* Effect.gen(function* () {
				const execution = yield* AutomationExecutionOperations;
				yield* reconcile.pipe(
					Effect.andThen(reconcile),
					Effect.provide(
						layer({
							submit: execution.submit,
							listQueuedCandidates: (input) =>
								Effect.sync(() => {
									reads.push(input);
									return [candidate("missed"), candidate("retry", 3)];
								}),
						}),
					),
				);
			}).pipe(
				Effect.provide(
					AutomationExecutionOperationsLive.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(WorkflowEngine, engine),
								AutomationRunRepository.layer,
								databaseLayer,
							),
						),
					),
				),
			);
			expect(reads).toEqual([
				{ now, limit: AUTOMATION_RECONCILIATION_BATCH_SIZE },
				{ now, limit: AUTOMATION_RECONCILIATION_BATCH_SIZE },
			]);
			const expected = [candidate("missed"), candidate("retry", 3)].map((run) => ({
				discard: true,
				payload: { runId: run.id, attemptNumber: run.attemptCount + 1 },
				executionId: automationAttemptIdentity(run.id, run.attemptCount + 1).workflowExecutionId,
			}));
			expect(submissions).toEqual([...expected, ...expected]);
		}),
);

it.effect(
	"continues the bounded batch after typed failures and defects without draining again",
	() =>
		Effect.gen(function* () {
			let reads = 0;
			const submitted: string[] = [];
			yield* reconcile.pipe(
				Effect.provide(
					layer({
						listQueuedCandidates: ({ limit }) =>
							Effect.sync(() => {
								reads += 1;
								return Array.from({ length: limit }, (_, index) => candidate(String(index)));
							}),
						submit: ({ runId }) =>
							Effect.gen(function* () {
								submitted.push(runId);
								if (runId === "0") {
									return yield* new DbError({ message: "unavailable" });
								}
								if (runId === "1") {
									return yield* Effect.die("submission defect");
								}
								return undefined;
							}),
					}),
				),
			);
			expect(reads).toBe(1);
			expect(submitted).toEqual(
				Array.from({ length: AUTOMATION_RECONCILIATION_BATCH_SIZE }, (_, i) => String(i)),
			);
		}),
);

it.effect("bounds concurrent handoffs and releases stalled submissions so later rows run", () =>
	Effect.gen(function* () {
		const submitted: string[] = [];
		const fiber = yield* reconcile.pipe(
			Effect.provide(
				layer({
					listQueuedCandidates: () =>
						Effect.succeed(
							Array.from({ length: AUTOMATION_IMMEDIATE_CONCURRENCY + 1 }, (_, i) =>
								candidate(String(i)),
							),
						),
					submit: ({ runId }) =>
						Effect.gen(function* () {
							submitted.push(runId);
							if (runId !== String(AUTOMATION_IMMEDIATE_CONCURRENCY)) {
								return yield* Effect.never;
							}
							return undefined;
						}),
				}),
			),
			Effect.forkChild,
		);
		yield* TestClock.adjust(1);
		expect(submitted).toHaveLength(AUTOMATION_IMMEDIATE_CONCURRENCY);
		yield* TestClock.adjust(AUTOMATION_IMMEDIATE_TIMEOUT_MS);
		yield* Fiber.join(fiber);
		expect(submitted).toHaveLength(AUTOMATION_IMMEDIATE_CONCURRENCY + 1);
	}),
);

it.effect("the scheduled task contains listing failure and can reconcile on the next tick", () =>
	Effect.gen(function* () {
		let reads = 0;
		const submitted: string[] = [];
		const tick = automationsFrequentTask.run({ executionId: "frequent-cron-test" });
		yield* tick.pipe(
			Effect.andThen(tick),
			Effect.provide(
				layer({
					submit: ({ runId }) =>
						Effect.sync(() => {
							submitted.push(runId);
						}),
					listQueuedCandidates: () =>
						Effect.gen(function* () {
							reads += 1;
							if (reads === 1) {
								return yield* new DbError({ message: "database offline" });
							}
							return [candidate("recovered")];
						}),
				}),
			),
		);
		expect(reads).toBe(2);
		expect(submitted).toEqual(["recovered"]);
	}),
);
