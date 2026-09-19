import { expect, it, layer } from "@effect/vitest";
import {
	decodePluginCatalogInvalidatedMessage,
	encodePluginCatalogInvalidatedMessage,
} from "@ryot-app/contract/modules/plugins/contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import {
	Context,
	Deferred,
	Effect,
	Fiber,
	Layer,
	Option,
	Queue,
	Ref,
	Result,
	Stream,
} from "effect";
import { TestClock } from "effect/testing";
import Redis from "ioredis";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { makeRedisService } from "#lib/test-utils/effect";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";

import {
	PluginCatalogHub,
	PluginCatalogInvalidator,
	PluginCatalogInvalidatorLive,
	PluginInvalidationSubscriber,
} from "./catalog-events";

const decode = (value: Uint8Array) => new TextDecoder().decode(value);

layer(PluginCatalogHub.layer)((test) => {
	test.effect("registers user-scoped queues and removes them with their scope", () =>
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
		}),
	);
});

layer(PluginCatalogHub.layer)((test) => {
	test.effect("emits a heartbeat after 25 seconds", () =>
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
	);
});

layer(PluginCatalogHub.layer)((test) => {
	test.effect("streams a user invalidation after the initial connection", () =>
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
	);
});

type PublishedMessage = { readonly channel: string; readonly message: string };

class RecordedPublications extends Context.Service<
	RecordedPublications,
	{
		readonly published: Effect.Effect<ReadonlyArray<PublishedMessage>>;
		readonly failingInvalidator: PluginCatalogInvalidator["Service"];
	}
>()("test/RecordedPublications") {}

const recordingInvalidatorLayer = Layer.effectContext(
	Effect.gen(function* () {
		const published = yield* Ref.make<ReadonlyArray<PublishedMessage>>([]);
		return Context.make(
			RedisService,
			makeRedisService({
				publish: (channel, message) =>
					Ref.update(published, (all) => [...all, { channel, message }]).pipe(Effect.as(1)),
			}),
		).pipe(
			Context.add(RecordedPublications, {
				published: Ref.get(published),
				failingInvalidator: yield* PluginCatalogInvalidator,
			}),
		);
	}),
).pipe(
	Layer.provide(
		Layer.fresh(PluginCatalogInvalidatorLive).pipe(
			Layer.provide(
				Layer.succeed(
					RedisService,
					makeRedisService({ publish: () => Effect.die("redis unavailable") }),
				),
			),
		),
	),
);

layer(
	PluginCatalogInvalidatorLive.pipe(
		Layer.provideMerge(recordingInvalidatorLayer),
		Layer.provideMerge(isolatedDatabaseLayer("plugin_catalog_events")),
	),
)((test) => {
	test.effect("recovers a committed invalidation after its request is interrupted", () =>
		Effect.gen(function* () {
			const invalidator = yield* PluginCatalogInvalidator;
			const database = yield* DatabaseSession;
			const recorded = yield* RecordedPublications;
			const committed = yield* Deferred.make<void>();
			const request = yield* database
				.transaction(invalidator.recordAll)
				.pipe(
					Effect.andThen(Deferred.succeed(committed, undefined)),
					Effect.andThen(Effect.never),
					Effect.forkChild,
				);
			yield* Deferred.await(committed);
			yield* Fiber.interrupt(request);
			expect(yield* recorded.published).toEqual([]);
			expect(
				yield* database.run((db) => db.select().from(schema.pluginCatalogChange)),
			).toHaveLength(1);
			yield* invalidator.deliverPending(100);
			expect((yield* recorded.published).map(({ channel }) => channel)).toEqual([
				redisKeys.pluginCatalogChannel,
			]);
			expect(yield* database.run((db) => db.select().from(schema.pluginCatalogChange))).toEqual([]);
		}),
	);
	test.effect(
		"publishes encoded user and global invalidations without surfacing Redis failures",
		() =>
			Effect.gen(function* () {
				const recorded = yield* RecordedPublications;
				const invalidator = yield* PluginCatalogInvalidator;
				const database = yield* DatabaseSession;
				const publishedBefore = (yield* recorded.published).length;
				const userId = UserId.make("user-1");
				yield* database.run((db) =>
					db
						.insert(schema.user)
						.values({ id: userId, name: "Test", preferences: {}, email: "test@example.com" }),
				);
				yield* database.transaction(
					invalidator.recordUser(userId).pipe(Effect.andThen(invalidator.recordAll)),
				);
				yield* invalidator.user(userId);
				yield* invalidator.all;
				const published = (yield* recorded.published).slice(publishedBefore);
				expect(published.map(({ channel }) => channel)).toEqual([
					redisKeys.pluginCatalogUserChannel,
					redisKeys.pluginCatalogChannel,
				]);
				const decoded = decodePluginCatalogInvalidatedMessage(published[0]?.message);
				expect(Result.isSuccess(decoded) && decoded.success.userId).toBe(userId);

				const failing = recorded.failingInvalidator;
				yield* database.transaction(invalidator.recordUser(userId));
				yield* failing.user(userId);
				const waiting = yield* database.run((db) => db.select().from(schema.pluginCatalogChange));
				expect(waiting).toHaveLength(1);
				yield* invalidator.deliverPending(100);
				expect(yield* database.run((db) => db.select().from(schema.pluginCatalogChange))).toEqual(
					[],
				);
				expect(
					(yield* recorded.published).slice(publishedBefore).map(({ channel }) => channel),
				).toEqual([
					redisKeys.pluginCatalogUserChannel,
					redisKeys.pluginCatalogChannel,
					redisKeys.pluginCatalogUserChannel,
				]);
				const rolledBack = yield* Effect.exit(
					database.transaction(invalidator.recordAll.pipe(Effect.andThen(Effect.fail("abort")))),
				);
				expect(rolledBack._tag).toBe("Failure");
				expect(yield* database.run((db) => db.select().from(schema.pluginCatalogChange))).toEqual(
					[],
				);
			}),
	);
});

class RedisSubscriptions extends Context.Service<RedisSubscriptions, Effect.Effect<number>>()(
	"test/RedisSubscriptions",
) {}

const recoveringSubscriberLayer = Layer.effectContext(
	Effect.gen(function* () {
		const subscriptions = yield* Ref.make(0);
		const runPromise = Effect.runPromiseWith(yield* Effect.context());
		const redisSubscriber = Object.assign(Object.create(Redis.prototype), {
			on: () => redisSubscriber,
			quit: () => Promise.resolve("OK"),
			removeAllListeners: () => redisSubscriber,
			subscribe: () =>
				runPromise(Ref.update(subscriptions, (count) => count + 1).pipe(Effect.as(2))),
		}) satisfies Redis;
		const client = Object.assign(Object.create(Redis.prototype), {
			duplicate: () => redisSubscriber,
		}) satisfies Redis;
		return Context.make(RedisService, makeRedisService({ client })).pipe(
			Context.add(RedisSubscriptions, Ref.get(subscriptions)),
		);
	}),
);

layer(
	PluginInvalidationSubscriber.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(PluginCatalogHub.layer, recoveringSubscriberLayer)),
	),
)((test) => {
	test.effect("routes Redis invalidations by user and refreshes all streams after recovery", () =>
		Effect.gen(function* () {
			const hub = yield* PluginCatalogHub;
			const subscriber = yield* PluginInvalidationSubscriber;
			const subscriptions = yield* RedisSubscriptions;
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

					yield* subscriber.dispatch(redisKeys.pluginCatalogChannel, "plugin-catalog-invalidated");
					expect(decode(yield* Queue.take(first))).toBe("event: catalog-invalidated\ndata:\n\n");
					expect(decode(yield* Queue.take(second))).toBe("event: catalog-invalidated\ndata:\n\n");

					yield* subscriber.recover;
					expect(yield* subscriptions).toBe(2);
					expect(decode(yield* Queue.take(first))).toBe("event: catalog-invalidated\ndata:\n\n");
					expect(decode(yield* Queue.take(second))).toBe("event: catalog-invalidated\ndata:\n\n");
				}),
			);
		}),
	);
});

it.effect("fails subscriber layer acquisition when the initial Redis subscription fails", () => {
	let quitCalls = 0;
	let removeListenerCalls = 0;
	const redisSubscriber = Object.assign(Object.create(Redis.prototype), {
		on: () => redisSubscriber,
		subscribe: () => Promise.reject(new Error("redis unavailable")),
		quit: () => {
			quitCalls += 1;
			return Promise.resolve("OK");
		},
		removeAllListeners: () => {
			removeListenerCalls += 1;
			return redisSubscriber;
		},
	}) satisfies Redis;
	const client = Object.assign(Object.create(Redis.prototype), {
		duplicate: () => redisSubscriber,
	}) satisfies Redis;
	const dependencies = Layer.mergeAll(
		PluginCatalogHub.layer,
		Layer.succeed(RedisService, makeRedisService({ client })),
	);

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			Layer.build(Layer.provideMerge(PluginInvalidationSubscriber.layer, dependencies)),
		);
		expect(exit._tag).toBe("Failure");
		expect(removeListenerCalls).toBe(1);
		expect(quitCalls).toBe(1);
	});
});
