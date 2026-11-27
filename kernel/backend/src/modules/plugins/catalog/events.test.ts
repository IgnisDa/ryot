import { expect } from "bun:test";

import { encodePluginCatalogInvalidatedMessage } from "@ryot-app/contract/modules/plugins/contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Duration, Effect, Fiber, Layer, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";

import { Broadcast } from "#platform/broadcast";
import { DatabaseSession } from "#platform/db/session";
import { awaitBroadcastListening } from "#testing/broadcast";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import {
	PluginCatalogHub,
	PluginCatalogInvalidator,
	PluginCatalogInvalidatorLive,
	PluginInvalidationSubscriber,
} from "./events";

const decode = (value: Uint8Array) => new TextDecoder().decode(value);

layer(PluginCatalogHub.layer)((test) => {
	test.effect(
		"registers user-scoped queues and removes them with their scope",
		() =>
			Effect.gen(function* () {
				const hub = yield* PluginCatalogHub;
				const firstUser = UserId.make("user-1");
				const secondUser = UserId.make("user-2");
				let released: undefined | Queue.Queue<Uint8Array>;

				yield* Effect.scoped(
					Effect.gen(function* () {
						const first = yield* hub.subscribe(firstUser);
						const second = yield* hub.subscribe(secondUser);
						released = first;
						expect(decode(yield* Queue.take(first))).toBe("event: connected\ndata:\n\n");
						expect(decode(yield* Queue.take(second))).toBe("event: connected\ndata:\n\n");

						yield* hub.broadcast(firstUser);
						expect(decode(yield* Queue.take(first))).toBe("event: catalog-invalidated\ndata:\n\n");
						expect(Option.isNone(yield* Queue.poll(second))).toBe(true);

						yield* hub.broadcastAll();
						expect(decode(yield* Queue.take(first))).toBe("event: catalog-invalidated\ndata:\n\n");
						expect(decode(yield* Queue.take(second))).toBe("event: catalog-invalidated\ndata:\n\n");
					}),
				);

				expect(released).toBeDefined();
				expect(released?.state._tag).toBe("Done");
			}),
		testTimeout,
	);
});

layer(PluginCatalogHub.layer)((test) => {
	test.effect(
		"emits a heartbeat after 25 seconds",
		() =>
			Effect.gen(function* () {
				const hub = yield* PluginCatalogHub;
				const messages = yield* Queue.unbounded<string>();
				const fiber = yield* hub.stream(UserId.make("user-1")).pipe(
					Stream.runForEach((message) => Queue.offer(messages, decode(message))),
					Effect.forkChild,
				);
				expect(yield* Queue.take(messages)).toBe("event: connected\ndata:\n\n");
				yield* TestClock.adjust("25 seconds");
				expect(yield* Queue.take(messages)).toBe(": ping\n\n");
				yield* Fiber.interrupt(fiber);
			}),
		testTimeout,
	);
});

layer(PluginCatalogHub.layer)((test) => {
	test.effect(
		"streams a user invalidation after the initial connection",
		() =>
			Effect.gen(function* () {
				const hub = yield* PluginCatalogHub;
				const userId = UserId.make("user-1");
				const messages = yield* Queue.unbounded<string>();
				const fiber = yield* hub.stream(userId).pipe(
					Stream.runForEach((message) => Queue.offer(messages, decode(message))),
					Effect.forkChild,
				);
				expect(yield* Queue.take(messages)).toBe("event: connected\ndata:\n\n");
				yield* hub.broadcast(userId);
				expect(yield* Queue.take(messages)).toBe("event: catalog-invalidated\ndata:\n\n");
				yield* Fiber.interrupt(fiber);
			}),
		testTimeout,
	);
});

const invalidatedFrame = "event: catalog-invalidated\ndata:\n\n";

const deliveryLayer = Layer.mergeAll(
	PluginCatalogInvalidatorLive,
	PluginInvalidationSubscriber.layer,
).pipe(
	Layer.provideMerge(PluginCatalogHub.layer),
	Layer.provideMerge(Layer.effect(Broadcast, Broadcast.make)),
	Layer.provideMerge(isolatedDatabaseLayer("plugin_catalog_events")),
);

const nextFrame = (queue: Queue.Queue<Uint8Array>) =>
	Queue.take(queue).pipe(Effect.map(decode), Effect.timeout(Duration.seconds(5)));

const streams = Effect.gen(function* () {
	const hub = yield* PluginCatalogHub;
	const first = yield* hub.subscribe(UserId.make("user-1"));
	const second = yield* hub.subscribe(UserId.make("user-2"));
	yield* Queue.take(first);
	yield* Queue.take(second);
	return { first, second };
});

layer(deliveryLayer, { excludeTestServices: true })((test) => {
	test.effect(
		"delivers a user invalidation only to that user's streams once its transaction commits",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					yield* awaitBroadcastListening;
					const invalidator = yield* PluginCatalogInvalidator;
					const database = yield* DatabaseSession;
					const { first, second } = yield* streams;

					yield* database.transaction(invalidator.user(UserId.make("user-1")));

					expect(yield* nextFrame(first)).toBe(invalidatedFrame);
					expect(Option.isNone(yield* Queue.poll(second))).toBe(true);
				}),
			),
		testTimeout,
	);

	test.effect(
		"sends nothing when the transaction rolls back",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					yield* awaitBroadcastListening;
					const invalidator = yield* PluginCatalogInvalidator;
					const database = yield* DatabaseSession;
					const { first, second } = yield* streams;
					const rolledBack = yield* Effect.exit(
						database.transaction(invalidator.all.pipe(Effect.andThen(Effect.fail("abort")))),
					);
					expect(rolledBack._tag).toBe("Failure");

					yield* database.transaction(invalidator.user(UserId.make("user-1")));

					expect(yield* nextFrame(first)).toBe(invalidatedFrame);
					expect(Option.isNone(yield* Queue.poll(second))).toBe(true);
				}),
			),
		testTimeout,
	);

	test.effect(
		"ignores a malformed message",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const subscriber = yield* PluginInvalidationSubscriber;
					const { first, second } = yield* streams;

					yield* subscriber.dispatch("malformed");
					expect(Option.isNone(yield* Queue.poll(first))).toBe(true);
					expect(Option.isNone(yield* Queue.poll(second))).toBe(true);

					yield* subscriber.dispatch(
						yield* Effect.fromResult(
							encodePluginCatalogInvalidatedMessage({ userId: UserId.make("user-2") }),
						),
					);
					expect(Option.isNone(yield* Queue.poll(first))).toBe(true);
					expect(decode(yield* Queue.take(second))).toBe(invalidatedFrame);
				}),
			),
		testTimeout,
	);
});
