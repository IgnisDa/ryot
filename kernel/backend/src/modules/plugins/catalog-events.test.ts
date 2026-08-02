import { expect, it } from "@effect/vitest";
import {
	decodePluginCatalogInvalidatedMessage,
	encodePluginCatalogInvalidatedMessage,
} from "@ryot-app/contract/modules/plugins/contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Fiber, Layer, Option, Queue, Result, Stream } from "effect";
import { TestClock } from "effect/testing";
import Redis from "ioredis";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { databaseLayer, makeRedisService } from "#lib/test-utils/effect";

import {
	PluginCatalogHub,
	PluginCatalogInvalidator,
	PluginCatalogInvalidatorLive,
} from "./catalog-events";
import { PluginIngestionService, PluginInvalidationSubscriber } from "./service";

const decode = (value: Uint8Array) => new TextDecoder().decode(value);

it.effect("registers user-scoped queues and removes them with their scope", () =>
	Effect.gen(function* () {
		const hub = yield* PluginCatalogHub;
		const firstUser = UserId.make("user-1");
		const secondUser = UserId.make("user-2");
		let released: Queue.Queue<Uint8Array> | undefined;

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
	}).pipe(Effect.provide(PluginCatalogHub.layer)),
);

it.effect("emits a heartbeat after 25 seconds", () =>
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
	}).pipe(Effect.provide(PluginCatalogHub.layer)),
);

it.effect(
	"publishes encoded user and global invalidations without surfacing Redis failures",
	() => {
		const published: Array<{ readonly channel: string; readonly message: string }> = [];
		const redisLayer = Layer.succeed(
			RedisService,
			makeRedisService({
				publish: (channel, message) =>
					Effect.sync(() => {
						published.push({ channel, message });
						return 1;
					}),
			}),
		);
		return Effect.gen(function* () {
			const invalidator = yield* PluginCatalogInvalidator;
			const userId = UserId.make("user-1");
			yield* invalidator.user(userId);
			yield* invalidator.all;
			expect(published.map(({ channel }) => channel)).toEqual([
				redisKeys.pluginCatalogUserChannel,
				redisKeys.pluginRegistryChannel,
			]);
			const decoded = decodePluginCatalogInvalidatedMessage(published[0]?.message);
			expect(Result.isSuccess(decoded) && decoded.success.userId).toBe(userId);

			const failing = yield* PluginCatalogInvalidator.pipe(
				Effect.provide(
					PluginCatalogInvalidatorLive.pipe(
						Layer.provide(
							Layer.succeed(
								RedisService,
								makeRedisService({ publish: () => Effect.die("redis unavailable") }),
							),
						),
					),
				),
			);
			yield* failing.user(userId);
			yield* failing.all;
		}).pipe(Effect.provide(PluginCatalogInvalidatorLive.pipe(Layer.provide(redisLayer))));
	},
);

it.effect("routes Redis invalidations by user and refreshes all streams after recovery", () => {
	let subscriptions = 0;
	let rebuilds = 0;
	const redisSubscriber = Object.assign(Object.create(Redis.prototype), {
		on: () => redisSubscriber,
		quit: () => Promise.resolve("OK"),
		removeAllListeners: () => redisSubscriber,
		subscribe: () => {
			subscriptions += 1;
			return Promise.resolve(2);
		},
	}) satisfies Redis;
	const client = Object.assign(Object.create(Redis.prototype), {
		duplicate: () => redisSubscriber,
	}) satisfies Redis;
	const dependencies = Layer.mergeAll(
		databaseLayer,
		PluginCatalogHub.layer,
		Layer.succeed(RedisService, makeRedisService({ client })),
		Layer.mock(PluginIngestionService)({
			reconcile: () => Effect.succeed(false),
			rebuild: () =>
				Effect.sync(() => void (rebuilds += 1)).pipe(Effect.andThen(Effect.die("rebuilt"))),
		}),
	);

	return Effect.gen(function* () {
		const hub = yield* PluginCatalogHub;
		const subscriber = yield* PluginInvalidationSubscriber;
		const firstUser = UserId.make("user-1");
		const secondUser = UserId.make("user-2");

		yield* Effect.scoped(
			Effect.gen(function* () {
				const first = yield* hub.subscribe(firstUser);
				const second = yield* hub.subscribe(secondUser);
				yield* Queue.take(first);
				yield* Queue.take(second);

				yield* subscriber.dispatch(
					redisKeys.pluginCatalogUserChannel,
					encodePluginCatalogInvalidatedMessage({ userId: firstUser }),
				);
				expect(decode(yield* Queue.take(first))).toBe("event: catalog-invalidated\ndata:\n\n");
				expect(Option.isNone(yield* Queue.poll(second))).toBe(true);

				yield* subscriber.dispatch(redisKeys.pluginCatalogUserChannel, "malformed");
				expect(Option.isNone(yield* Queue.poll(first))).toBe(true);
				expect(Option.isNone(yield* Queue.poll(second))).toBe(true);

				yield* subscriber
					.dispatch(redisKeys.pluginRegistryChannel, "registry changed")
					.pipe(Effect.ignoreCause);
				expect(rebuilds).toBe(1);
				expect(decode(yield* Queue.take(first))).toBe("event: catalog-invalidated\ndata:\n\n");
				expect(decode(yield* Queue.take(second))).toBe("event: catalog-invalidated\ndata:\n\n");

				yield* subscriber.recover;
				expect(subscriptions).toBe(2);
				expect(decode(yield* Queue.take(first))).toBe("event: catalog-invalidated\ndata:\n\n");
				expect(decode(yield* Queue.take(second))).toBe("event: catalog-invalidated\ndata:\n\n");
			}),
		);
	}).pipe(Effect.provide(Layer.provideMerge(PluginInvalidationSubscriber.layer, dependencies)));
});
