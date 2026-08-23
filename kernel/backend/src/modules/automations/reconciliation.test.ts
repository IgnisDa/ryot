import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Context, DateTime, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";

import { databaseLayer } from "#lib/test-utils/effect";

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
import {
	RunWorkflowSubmissions,
	recordingRunWorkflowEngineLayer,
} from "./run-workflow-engine.test-support";

const candidate = (id: string, attemptCount = 0) => ({
	attemptCount,
	id: AutomationRunId.make(id),
});
type Operations = AutomationReconciliationOperations["Service"];
type ListInput = Parameters<Operations["listQueuedCandidates"]>[0];

class ReconciliationCalls extends Context.Service<
	ReconciliationCalls,
	{
		readonly reads: Effect.Effect<ReadonlyArray<ListInput>>;
		readonly submitted: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/ReconciliationCalls") {}

const reconciliationLayer = (behavior: {
	readonly submit: Operations["submit"];
	readonly listQueuedCandidates: (
		input: ListInput,
		read: number,
	) => ReturnType<Operations["listQueuedCandidates"]>;
}) =>
	AutomationReconciliation.layer.pipe(
		Layer.provideMerge(
			Layer.effectContext(
				Effect.gen(function* () {
					const reads = yield* Ref.make<ReadonlyArray<ListInput>>([]);
					const submitted = yield* Ref.make<ReadonlyArray<string>>([]);
					return Context.make(
						AutomationReconciliationOperations,
						AutomationReconciliationOperations.of({
							submit: (input) =>
								Ref.update(submitted, (all) => [...all, input.runId]).pipe(
									Effect.andThen(behavior.submit(input)),
								),
							listQueuedCandidates: (input) =>
								Ref.modify(reads, (all) => [all.length, [...all, input]] as const).pipe(
									Effect.flatMap((read) => behavior.listQueuedCandidates(input, read)),
								),
						}),
					).pipe(
						Context.add(ReconciliationCalls, {
							reads: Ref.get(reads),
							submitted: Ref.get(submitted),
						}),
					);
				}),
			),
		),
	);

const liveSubmissionLayer = Layer.unwrap(
	Effect.map(AutomationExecutionOperations, (execution) =>
		reconciliationLayer({
			submit: execution.submit,
			listQueuedCandidates: () => Effect.succeed([candidate("missed"), candidate("retry", 3)]),
		}),
	),
).pipe(
	Layer.provideMerge(
		AutomationExecutionOperationsLive.pipe(
			Layer.provide(AutomationRunRepository.layer.pipe(Layer.provide(databaseLayer))),
			Layer.provideMerge(recordingRunWorkflowEngineLayer()),
		),
	),
);

const reconcile = Effect.flatMap(AutomationReconciliation, (service) => service.reconcile());

layer(liveSubmissionLayer)((test) => {
	test.effect(
		"submits missed initial runs and due retries with the same deterministic ID on replay",
		() =>
			Effect.gen(function* () {
				const now = DateTime.toDate(yield* DateTime.now);
				yield* reconcile.pipe(Effect.andThen(reconcile));
				expect(yield* (yield* ReconciliationCalls).reads).toEqual([
					{ now, limit: AUTOMATION_RECONCILIATION_BATCH_SIZE },
					{ now, limit: AUTOMATION_RECONCILIATION_BATCH_SIZE },
				]);
				const expected = [candidate("missed"), candidate("retry", 3)].map((run) => ({
					discard: true,
					payload: { runId: run.id, acceptedPatches: [], attemptNumber: run.attemptCount + 1 },
					executionId: automationAttemptIdentity(run.id, run.attemptCount + 1).workflowExecutionId,
				}));
				expect(yield* yield* RunWorkflowSubmissions).toEqual([...expected, ...expected]);
			}),
	);
});

layer(
	reconciliationLayer({
		listQueuedCandidates: ({ limit }) =>
			Effect.succeed(Array.from({ length: limit }, (_, index) => candidate(String(index)))),
		submit: ({ runId }) =>
			Effect.gen(function* () {
				if (runId === "0") {
					return yield* new DbError({ message: "unavailable" });
				}
				if (runId === "1") {
					return yield* Effect.die("submission defect");
				}
				return undefined;
			}),
	}),
)((test) => {
	test.effect(
		"continues the bounded batch after typed failures and defects without draining again",
		() =>
			Effect.gen(function* () {
				const calls = yield* ReconciliationCalls;
				yield* reconcile;
				expect(yield* calls.reads).toHaveLength(1);
				expect(yield* calls.submitted).toEqual(
					Array.from({ length: AUTOMATION_RECONCILIATION_BATCH_SIZE }, (_, i) => String(i)),
				);
			}),
	);
});

layer(
	reconciliationLayer({
		submit: ({ runId }) =>
			runId === String(AUTOMATION_IMMEDIATE_CONCURRENCY) ? Effect.void : Effect.never,
		listQueuedCandidates: () =>
			Effect.succeed(
				Array.from({ length: AUTOMATION_IMMEDIATE_CONCURRENCY + 1 }, (_, i) =>
					candidate(String(i)),
				),
			),
	}),
)((test) => {
	test.effect("bounds concurrent handoffs and releases stalled submissions so later rows run", () =>
		Effect.gen(function* () {
			const { submitted } = yield* ReconciliationCalls;
			const fiber = yield* reconcile.pipe(Effect.forkChild);
			yield* TestClock.adjust(1);
			expect(yield* submitted).toHaveLength(AUTOMATION_IMMEDIATE_CONCURRENCY);
			yield* TestClock.adjust(AUTOMATION_IMMEDIATE_TIMEOUT_MS);
			yield* Fiber.join(fiber);
			expect(yield* submitted).toHaveLength(AUTOMATION_IMMEDIATE_CONCURRENCY + 1);
		}),
	);
});

layer(
	reconciliationLayer({
		submit: () => Effect.void,
		listQueuedCandidates: (_input, read) =>
			read === 0
				? Effect.fail(new DbError({ message: "database offline" }))
				: Effect.succeed([candidate("recovered")]),
	}),
)((test) => {
	test.effect(
		"the scheduled task contains listing failure and can reconcile on the next tick",
		() =>
			Effect.gen(function* () {
				const calls = yield* ReconciliationCalls;
				const tick = automationsFrequentTask.run({ executionId: "frequent-cron-test" });
				yield* tick.pipe(Effect.andThen(tick));
				expect(yield* calls.reads).toHaveLength(2);
				expect(yield* calls.submitted).toEqual(["recovered"]);
			}),
	);
});
