import { expect } from "bun:test";

import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { layer } from "@voila.dev/effect-bun-test";
import { sql } from "drizzle-orm";
import { Context, type Duration, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";

import { Broadcast } from "#platform/broadcast";
import { DatabaseSession } from "#platform/db/session";
import { awaitBroadcastListening } from "#testing/broadcast";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { awaitWorkflowSettled, WorkflowExecutionNotifications } from "./execution-notifications";

const firstIdentity = { executionId: "b", workflowName: "workflow:a" };
const collidingIdentity = { executionId: "a:b", workflowName: "workflow" };
layer(WorkflowExecutionNotifications.layer.pipe(Layer.provideMerge(TestClock.layer())))((test) => {
	test.effect(
		"wakes every matching listener without crossing identity boundaries",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const notifications = yield* WorkflowExecutionNotifications;
					const firstWaiter = yield* notifications.listen(firstIdentity);
					const secondWaiter = yield* notifications.listen(firstIdentity);
					const collisionWaiter = yield* notifications.listen(collidingIdentity);
					const collisionFiber = yield* Effect.forkChild(
						Effect.timeoutOption(collisionWaiter, "1 second"),
					);

					yield* notifications.publish(firstIdentity);
					yield* firstWaiter;
					yield* secondWaiter;
					yield* TestClock.adjust("1 second");
					expect(yield* Fiber.join(collisionFiber)).toEqual(Option.none());
				}),
			),
		testTimeout,
	);

	test.effect(
		"awaitWorkflowSettled re-reads on a hint and on the backstop, then once at the timeout",
		() =>
			Effect.gen(function* () {
				const notifications = yield* WorkflowExecutionNotifications;
				const reads = yield* Ref.make(0);
				const waiting = yield* Effect.forkChild(
					awaitWorkflowSettled({
						timeout: "30 seconds",
						backstop: "10 seconds",
						identities: [firstIdentity],
						isSettled: (count: number) => count >= 3,
						read: Ref.updateAndGet(reads, (count) => count + 1),
					}),
				);
				yield* Effect.yieldNow;
				expect(yield* Ref.get(reads)).toBe(1);
				yield* notifications.publish(firstIdentity);
				yield* Effect.yieldNow;
				expect(yield* Ref.get(reads)).toBe(2);
				yield* TestClock.adjust("10 seconds");
				expect(yield* Fiber.join(waiting)).toBe(3);
				expect(
					yield* awaitWorkflowSettled({
						timeout: "5 seconds",
						backstop: "10 seconds",
						isSettled: () => false,
						identities: [firstIdentity],
						read: Ref.updateAndGet(reads, (count) => count + 1),
					}).pipe(
						Effect.forkChild,
						Effect.tap(() => TestClock.adjust("5 seconds")),
						Effect.flatMap(Fiber.join),
					),
				).toBe(5);
			}),
		testTimeout,
	);

	test.effect(
		"releases listeners and does not retain published results",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const notifications = yield* WorkflowExecutionNotifications;
					yield* Effect.scoped(
						Effect.gen(function* () {
							const waiter = yield* notifications.listen(firstIdentity);
							yield* notifications.publish(firstIdentity);
							yield* waiter;
						}),
					);
					yield* notifications.publish(firstIdentity);
					const waiter = yield* notifications.listen(firstIdentity);
					const fiber = yield* Effect.forkChild(Effect.timeoutOption(waiter, "1 second"));
					yield* TestClock.adjust("1 second");
					expect(yield* Fiber.join(fiber)).toEqual(Option.none());
				}),
			),
		testTimeout,
	);
});

const liveInstance = Layer.fresh(
	WorkflowExecutionNotifications.liveLayer.pipe(
		Layer.provideMerge(Layer.effect(Broadcast, Broadcast.make)),
	),
);

const heard = (waiter: Effect.Effect<void>, within: Duration.Input) =>
	Effect.timeoutOption(waiter, within).pipe(Effect.map(Option.isSome));

layer(isolatedDatabaseLayer("workflow_notifications"), { excludeTestServices: true })((test) => {
	test.effect(
		"delivers notifications between live instances",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const first = yield* Layer.build(liveInstance);
					const second = yield* Layer.build(liveInstance);
					yield* awaitBroadcastListening.pipe(Effect.provideContext(second));
					const identity = {
						executionId: yield* randomUuid,
						workflowName: "CrossInstanceWorkflow",
					};
					const waiter = yield* Context.get(second, WorkflowExecutionNotifications).listen(
						identity,
					);

					yield* Context.get(first, Broadcast).publish("workflow-execution", "malformed");
					expect(yield* heard(waiter, "100 millis")).toBe(false);
					yield* Context.get(first, WorkflowExecutionNotifications).publish(identity);
					expect(yield* heard(waiter, "5 seconds")).toBe(true);
				}),
			),
		testTimeout,
	);

	test.effect(
		"wakes every listener and hears new notifications after the connection comes back",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(liveInstance);
					yield* awaitBroadcastListening.pipe(Effect.provideContext(context));
					const notifications = Context.get(context, WorkflowExecutionNotifications);
					const recoveryWaiter = yield* notifications.listen({
						executionId: yield* randomUuid,
						workflowName: "ReconnectWorkflow",
					});

					yield* (yield* DatabaseSession).run((db) =>
						db.execute(
							sql`select pg_terminate_backend(pid) from pg_stat_activity
							where datname = current_database() and pid <> pg_backend_pid() and query ilike 'listen%'`,
						),
					);
					expect(yield* heard(recoveryWaiter, "10 seconds")).toBe(true);

					const fresh = { executionId: yield* randomUuid, workflowName: "ReconnectedWorkflow" };
					const freshWaiter = yield* notifications.listen(fresh);
					yield* Context.get(context, Broadcast).publish(
						"workflow-execution",
						stableStringify(fresh),
					);
					expect(yield* heard(freshWaiter, "5 seconds")).toBe(true);
				}),
			),
		testTimeout,
	);
});
