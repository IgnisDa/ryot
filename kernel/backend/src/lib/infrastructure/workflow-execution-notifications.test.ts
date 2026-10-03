import { expect, it, layer } from "@effect/vitest";
import { Context, Effect, Exit, Fiber, Layer, Option, Redacted, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";

import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { testRedisServiceLayer, testRedisUrl } from "#lib/test-utils/redis";

import { encodeWorkflowExecutionNotificationMessage, redisKeys, RedisService } from "./redis";
import { WorkflowExecutionNotifications } from "./workflow-execution-notifications";

const firstIdentity = { executionId: "b", workflowName: "workflow:a" };
const collidingIdentity = { executionId: "a:b", workflowName: "workflow" };
const makeLiveContext = () =>
	Layer.build(
		WorkflowExecutionNotifications.liveLayer.pipe(
			Layer.provide(
				RedisService.layer.pipe(
					Layer.provide(makeAppConfigLayer({ redisUrl: Redacted.make(testRedisUrl()) })),
				),
			),
		),
	);
const makeNamedRedisService = (redis: RedisService["Service"], connectionName: string) =>
	Effect.acquireRelease(
		Effect.sync(() =>
			redis.client.duplicate({ connectionName, lazyConnect: true, retryStrategy: () => 100 }),
		),
		(client) => Effect.sync(() => client.disconnect()),
	).pipe(Effect.map((client) => ({ ...redis, client })));
const namedPubsubClientLines = (
	client: RedisService["Service"]["client"],
	connectionName: string,
) =>
	Effect.tryPromise(() => client.call("CLIENT", "LIST", "TYPE", "PUBSUB")).pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.String)),
		Effect.map((response) =>
			response.split("\n").filter((line) => line.split(" ").includes(`name=${connectionName}`)),
		),
	);
const namedPubsubClientId = (client: RedisService["Service"]["client"], connectionName: string) =>
	Effect.gen(function* () {
		const lines = yield* namedPubsubClientLines(client, connectionName);
		expect(lines).toHaveLength(1);
		const id = lines[0]
			?.split(" ")
			.find((field) => field.startsWith("id="))
			?.slice(3);
		return yield* Schema.decodeUnknownEffect(Schema.String)(id);
	});

layer(WorkflowExecutionNotifications.layer.pipe(Layer.provideMerge(TestClock.layer())))((test) => {
	test.effect("wakes every matching listener without crossing identity boundaries", () =>
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
	);

	test.effect("releases listeners and does not retain published results", () =>
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
	);
});

it.effect("delivers an immediate notification between live instances through Redis", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const first = Context.get(yield* makeLiveContext(), WorkflowExecutionNotifications);
			const second = Context.get(yield* makeLiveContext(), WorkflowExecutionNotifications);
			const identity = {
				executionId: crypto.randomUUID(),
				workflowName: "ImmediateCrossInstanceWorkflow",
			};
			const waiter = yield* second.listen(identity);

			yield* first.publish(identity);
			expect(
				Option.isSome(yield* Effect.timeoutOption(waiter, "5 seconds").pipe(TestClock.withLive)),
			).toBe(true);
		}),
	),
);

it.effect("delivers notifications between live instances through Redis", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const first = Context.get(yield* makeLiveContext(), WorkflowExecutionNotifications);
			const second = Context.get(yield* makeLiveContext(), WorkflowExecutionNotifications);
			const publisher = Context.get(yield* Layer.build(testRedisServiceLayer), RedisService);
			const identity = { executionId: crypto.randomUUID(), workflowName: "CrossInstanceWorkflow" };
			const waiter = yield* second.listen(identity);

			yield* Effect.tryPromise(() =>
				publisher.client.publish(redisKeys.workflowExecutionNotificationChannel, "malformed"),
			);
			expect(
				Option.isNone(yield* Effect.timeoutOption(waiter, "100 millis").pipe(TestClock.withLive)),
			).toBe(true);
			yield* first.publish(identity);
			expect(
				Option.isSome(yield* Effect.timeoutOption(waiter, "5 seconds").pipe(TestClock.withLive)),
			).toBe(true);
		}),
	),
);

it.effect("resubscribes after the Redis subscriber reconnects", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const publisher = Context.get(yield* Layer.build(testRedisServiceLayer), RedisService);
			const connectionName = `workflow-notifications-${crypto.randomUUID()}`;
			const namedRedis = yield* makeNamedRedisService(publisher, connectionName);
			const context = yield* Layer.build(
				WorkflowExecutionNotifications.liveLayer.pipe(
					Layer.provide(Layer.succeed(RedisService, namedRedis)),
				),
			);
			const notifications = Context.get(context, WorkflowExecutionNotifications);
			const identity = { executionId: crypto.randomUUID(), workflowName: "ReconnectWorkflow" };
			const recoveryWaiter = yield* notifications.listen(identity);
			const subscriberId = yield* namedPubsubClientId(publisher.client, connectionName);

			yield* Effect.tryPromise(() => publisher.client.call("CLIENT", "KILL", "ID", subscriberId));
			expect(
				Option.isSome(
					yield* Effect.timeoutOption(recoveryWaiter, "5 seconds").pipe(TestClock.withLive),
				),
			).toBe(true);

			const freshIdentity = {
				executionId: crypto.randomUUID(),
				workflowName: "ReconnectedWorkflow",
			};
			const freshWaiter = yield* notifications.listen(freshIdentity);
			yield* Effect.tryPromise(() =>
				publisher.client.publish(
					redisKeys.workflowExecutionNotificationChannel,
					encodeWorkflowExecutionNotificationMessage(freshIdentity),
				),
			);
			expect(
				Option.isSome(
					yield* Effect.timeoutOption(freshWaiter, "5 seconds").pipe(TestClock.withLive),
				),
			).toBe(true);
		}),
	),
);

it.effect("does not reconnect a subscriber after its layer scope closes", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const publisher = Context.get(yield* Layer.build(testRedisServiceLayer), RedisService);
			const connectionName = `workflow-notifications-${crypto.randomUUID()}`;
			const subscriberScope = yield* Scope.make();
			yield* Effect.addFinalizer(() => Scope.close(subscriberScope, Exit.void));
			const namedRedis = yield* makeNamedRedisService(publisher, connectionName).pipe(
				Effect.provideService(Scope.Scope, subscriberScope),
			);
			yield* Layer.build(
				WorkflowExecutionNotifications.liveLayer.pipe(
					Layer.provide(Layer.succeed(RedisService, namedRedis)),
				),
			).pipe(Effect.provideService(Scope.Scope, subscriberScope));
			const subscriberId = yield* namedPubsubClientId(publisher.client, connectionName);

			yield* Effect.tryPromise(() => publisher.client.call("CLIENT", "KILL", "ID", subscriberId));
			yield* Effect.sleep("20 millis").pipe(TestClock.withLive);
			yield* Scope.close(subscriberScope, Exit.void);
			expect(yield* namedPubsubClientLines(publisher.client, connectionName)).toEqual([]);
			yield* Effect.sleep("300 millis").pipe(TestClock.withLive);
			expect(yield* namedPubsubClientLines(publisher.client, connectionName)).toEqual([]);
		}),
	),
);
