import { expect, it, layer } from "@effect/vitest";
import { Clock, Effect, Fiber, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { PersistedQueue } from "effect/unstable/persistence";
import { Workflow, DurableQueue } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowEngine, workflowEngineTestLayer } from "#lib/test-utils/effect";

import { observeWorkflowDeadline, startWorkflowDeadline } from "./workflow-deadline";
import { implementWorkflow } from "./workflow-scope";

it.effect(
	"bounds both polling intervals by the absolute cutoff and rejects completion at the cutoff",
	() =>
		Effect.gen(function* () {
			for (const pollingIntervalMs of [500, 1_000]) {
				const started = yield* Clock.currentTimeMillis;
				const polls: number[] = [];
				const observing = yield* observeWorkflowDeadline({
					pollingIntervalMs,
					deadline: started + 1_250,
					completedAt: (value: number) => value,
					poll: Clock.currentTimeMillis.pipe(
						Effect.map((now) => {
							polls.push(now - started);
							return now >= started + 1_250 ? now : null;
						}),
					),
				}).pipe(Effect.forkChild);
				yield* TestClock.adjust(1_250);
				expect(yield* Fiber.join(observing)).toEqual({ status: "expired" });
				expect(polls).toEqual(
					pollingIntervalMs === 500 ? [0, 500, 1_000, 1_250] : [0, 1_000, 1_250],
				);
				expect(
					yield* observeWorkflowDeadline({
						pollingIntervalMs,
						deadline: started + 1_250,
						completedAt: (value: number) => value,
						poll: Effect.succeed(started + 1_249),
					}),
				).toEqual({ status: "completed", value: started + 1_249 });
			}
		}),
);

const Child = Workflow.make("DeadlineChild", {
	success: Schema.String,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});
const Parent = Workflow.make("DeadlineParent", {
	success: Schema.String,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});
const Queue = DurableQueue.make({
	error: Schema.Never,
	success: Schema.String,
	name: "DeadlineTestQueue",
	idempotencyKey: ({ id }) => id,
	payload: Schema.Struct({ id: Schema.String }),
});
const QueuedChild = Workflow.make("QueuedDeadlineChild", {
	error: Schema.Never,
	success: Schema.String,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const engineLayer = Layer.mergeAll(
	implementWorkflow(Child, ({ id }) =>
		id.startsWith("slow")
			? Effect.sleep("2 seconds").pipe(Effect.as("done"))
			: Effect.succeed("done"),
	),
	implementWorkflow(Parent, ({ id }) =>
		Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const deadline = yield* startWorkflowDeadline("child", 1000);
			const childId = `${id}-child`;
			yield* engine.execute(Child, {
				discard: true,
				executionId: childId,
				payload: { id: childId },
			});
			const result = yield* observeWorkflowDeadline({
				deadline,
				completedAt: () => null,
				pollingIntervalMs: 1_000,
				poll: Effect.gen(function* () {
					const value = Option.getOrUndefined(yield* engine.poll(Child, childId));
					return value?._tag === "Complete" ? yield* value.exit : null;
				}),
			});
			return result.status === "completed" ? result.value : "expired";
		}),
	),
).pipe(Layer.provideMerge(workflowEngineTestLayer));

layer(engineLayer)((test) => {
	test.effect("polls a persisted deadline without scheduling a durable clock per retry", () =>
		TestClock.withLive(
			Effect.gen(function* () {
				let polls = 0;
				const deadline = (yield* Clock.currentTimeMillis) + 1_500;
				const observed = yield* observeWorkflowDeadline({
					deadline,
					completedAt: () => null,
					pollingIntervalMs: 1_000,
					poll: Effect.sync(() => (++polls === 2 ? "completed" : null)),
				}).pipe(
					Effect.provideService(WorkflowInstance, WorkflowInstance.initial(Parent, "poll-replay")),
					Effect.provideService(
						WorkflowEngine,
						makeWorkflowEngine({
							scheduleClock: () => Effect.die("poll scheduled a durable clock"),
						}),
					),
				);
				expect(observed).toEqual({ value: "completed", status: "completed" });
				expect(polls).toBe(2);
			}),
		),
	);
	test.effect("returns child completion before the durable deadline", () =>
		TestClock.withLive(
			Effect.gen(function* () {
				expect(yield* Parent.execute({ id: "success" })).toBe("done");
			}),
		),
	);
	test.effect("expires while the child workflow is suspended", () =>
		TestClock.withLive(
			Effect.gen(function* () {
				expect(yield* Parent.execute({ id: "slow" })).toBe("expired");
			}),
		),
	);
});

const queuedLayer = Layer.mergeAll(
	implementWorkflow(QueuedChild, ({ id }) => DurableQueue.process(Queue, { id })),
	DurableQueue.worker(
		Queue,
		({ id }) => TestClock.withLive(Effect.sleep("1500 millis")).pipe(Effect.as(id)),
		{ concurrency: 1 },
	),
	implementWorkflow(Parent, ({ id }) =>
		Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const deadline = yield* startWorkflowDeadline("queue", 500);
			yield* engine.execute(QueuedChild, {
				discard: true,
				payload: { id },
				executionId: `${id}-queue`,
			});
			const observed = yield* observeWorkflowDeadline({
				deadline,
				completedAt: () => null,
				pollingIntervalMs: 1_000,
				poll: Effect.gen(function* () {
					const value = Option.getOrUndefined(yield* engine.poll(QueuedChild, `${id}-queue`));
					return value?._tag === "Complete" ? yield* value.exit : null;
				}),
			});
			return observed.status === "expired" ? "pending" : observed.value;
		}),
	),
).pipe(
	Layer.provideMerge(PersistedQueue.layer.pipe(Layer.provide(PersistedQueue.layerStoreMemory))),
	Layer.provideMerge(workflowEngineTestLayer),
);

layer(queuedLayer)((test) => {
	test.effect("returns on the deadline while durable queued work finishes later", () =>
		TestClock.withLive(
			Effect.gen(function* () {
				const engine = yield* WorkflowEngine;
				expect(yield* Parent.execute({ id: "queued" })).toBe("pending");
				expect(
					yield* engine.execute(QueuedChild, {
						payload: { id: "queued" },
						executionId: "queued-queue",
					}),
				).toBe("queued");
			}),
		),
	);
});
