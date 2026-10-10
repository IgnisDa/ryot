import { expect, layer } from "@effect/vitest";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Deferred, Duration, Effect, Exit, Fiber, Metric, Schedule, Schema, Scope } from "effect";
import type { PersistedQueue } from "effect/persistence";

import { testRedisServiceLayer } from "#lib/test-utils/redis";

import {
	FairQueueFlow,
	fairQueueKeys,
	makeFairQueueStore,
	type FairQueueOptions,
} from "./fair-queue-store";
import { RedisService } from "./redis";

type Client = RedisService["Service"]["client"];

const queueName = "fair";
const interactive = "interactive";
const background = "background";

const decodeFlow = Schema.decodeUnknownEffect(FairQueueFlow);

const entry = (
	lane: typeof interactive | typeof background,
	tenant: string,
	plugin: string,
	n = 0,
) => ({ n, lane, tenant, plugin });

const lanesTaken = (store: PersistedQueue.PersistedQueueStore["Service"]) =>
	interactiveFlowOrder(store, 3).pipe(
		Effect.map((items) => items.map((item) => item.lane)),
		Effect.timeout("5 seconds"),
	);

const takeOptions = (maxAttempts = 5) => ({
	maxAttempts,
	name: queueName,
	retryDelay: () => Effect.succeed(Duration.zero),
});

const withIsolatedRegistry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, Metric.MetricRegistry, new Map());

const eventually = <E, R>(check: Effect.Effect<boolean, E, R>) =>
	check.pipe(
		Effect.repeat({ until: (done) => done, schedule: Schedule.spaced(10) }),
		Effect.timeout("10 seconds"),
	);

const settle = Effect.sleep(250);

const call = <A>(run: () => Promise<A>) => Effect.tryPromise(run).pipe(Effect.orDie);

const readKey = Effect.fnUntraced(function* (client: Client, key: string) {
	const type = yield* call(() => client.type(key));
	switch (type) {
		case "string":
			return yield* call(() => client.get(key));
		case "list":
			return yield* call(() => client.lrange(key, 0, -1));
		case "hash":
			return yield* call(() => client.hgetall(key));
		case "set":
			return sortBy(yield* call(() => client.smembers(key)));
		case "zset":
			return yield* call(() => client.zrange(key, 0, -1, "WITHSCORES"));
		default:
			return type;
	}
});

const redisSnapshot = Effect.fnUntraced(function* (client: Client, prefix: string) {
	const keys = yield* call(() => client.keys(`${prefix}*`));
	const entries = yield* Effect.forEach(sortBy(keys), (key) =>
		Effect.map(readKey(client, key), (value) => [key, value] as const),
	);
	return Object.fromEntries(entries);
});

const deleteKeys = Effect.fnUntraced(function* (client: Client, prefix: string) {
	const keys = yield* call(() => client.keys(`${prefix}*`));
	if (keys.length > 0) {
		yield* call(() => client.del(...keys));
	}
});

const storeOptions = (prefix: string, overrides: Partial<FairQueueOptions>): FairQueueOptions => ({
	prefix,
	flowOf: decodeFlow,
	pollInterval: Duration.millis(5),
	lanes: [interactive, background],
	capacity: { total: 100, background: 50 },
	...overrides,
});

const makeTestStore = Effect.fnUntraced(function* (overrides: Partial<FairQueueOptions> = {}) {
	const { client } = yield* RedisService;
	const prefix = overrides.prefix ?? `ryot:test:fair:${crypto.randomUUID()}:`;
	yield* Effect.addFinalizer(() => deleteKeys(client, prefix));
	const made = yield* makeFairQueueStore(storeOptions(prefix, overrides));
	return { ...made, client, prefix, keys: fairQueueKeys(prefix, queueName) };
});

const offerAll = (
	store: PersistedQueue.PersistedQueueStore["Service"],
	elements: ReadonlyArray<unknown>,
) =>
	Effect.forEach(
		elements,
		(element) =>
			store.offer({ element, name: queueName, isCustomId: false, id: crypto.randomUUID() }),
		{ discard: true },
	);

const takeThenComplete = (store: PersistedQueue.PersistedQueueStore["Service"]) =>
	Effect.scoped(store.take(takeOptions()));

const holdTake = Effect.fnUntraced(function* (
	store: PersistedQueue.PersistedQueueStore["Service"],
	maxAttempts = 5,
) {
	const received = yield* Deferred.make<Effect.Success<ReturnType<typeof takeThenComplete>>>();
	const finish = yield* Deferred.make<void, string>();
	const fiber = yield* Effect.forkChild(
		Effect.scoped(
			store.take(takeOptions(maxAttempts)).pipe(
				Effect.tap((item) => Deferred.succeed(received, item)),
				Effect.andThen(Deferred.await(finish)),
			),
		),
	);
	return { fiber, finish, received };
});

const decodeEntry = Schema.decodeUnknownEffect(
	Schema.Struct({
		n: Schema.Int,
		tenant: Schema.String,
		plugin: Schema.String,
		lane: Schema.Literals([interactive, background]),
	}),
);

const interactiveFlowOrder = Effect.fnUntraced(function* (
	store: PersistedQueue.PersistedQueueStore["Service"],
	count: number,
) {
	const order: Array<ReturnType<typeof entry>> = [];
	for (let index = 0; index < count; index += 1) {
		const item = yield* takeThenComplete(store);
		order.push(yield* decodeEntry(item.element));
	}
	return order;
});

const dispatchOrder = Effect.fnUntraced(function* (aPlugins: ReadonlyArray<string>) {
	const { store } = yield* makeTestStore();
	const perPlugin = 60 / aPlugins.length;
	yield* offerAll(
		store,
		aPlugins.flatMap((plugin) =>
			Array.from({ length: perPlugin }, (_, n) => entry(interactive, "user:a", plugin, n)),
		),
	);
	yield* offerAll(
		store,
		Array.from({ length: 20 }, (_, n) => entry(interactive, "user:b", "pb", n)),
	);
	return yield* interactiveFlowOrder(store, 80);
});

layer(testRedisServiceLayer, { excludeTestServices: true })((test) => {
	test.effect("execution_admission_is_fair_across_users_and_plugins", () =>
		Effect.gen(function* () {
			const threePlugins = yield* dispatchOrder(["pa1", "pa2", "pa3"]);
			const onePlugin = yield* dispatchOrder(["pa1"]);

			for (const order of [threePlugins, onePlugin]) {
				expect(order.slice(0, 40).map((item) => item.tenant)).toEqual(
					Array.from({ length: 20 }, () => ["user:a", "user:b"]).flat(),
				);
				expect(order.slice(40).every((item) => item.tenant === "user:a")).toBe(true);
			}
			const aOrder = threePlugins.filter((item) => item.tenant === "user:a");
			expect(aOrder.slice(0, 6).map((item) => item.plugin)).toEqual([
				"pa1",
				"pa2",
				"pa3",
				"pa1",
				"pa2",
				"pa3",
			]);
			for (const plugin of ["pa1", "pa2", "pa3"]) {
				expect(aOrder.filter((item) => item.plugin === plugin).map((item) => item.n)).toEqual(
					Array.from({ length: 20 }, (_, n) => n),
				);
			}
			expect(threePlugins.filter((item) => item.tenant === "user:b").map((item) => item.n)).toEqual(
				Array.from({ length: 20 }, (_, n) => n),
			);
		}),
	);

	test.effect("a lane-pinned store only hands out items of its own lanes", () =>
		Effect.gen(function* () {
			const backgroundRole = yield* makeTestStore({ lanes: [background] });
			const interactiveRole = yield* makeTestStore({
				lanes: [interactive],
				prefix: backgroundRole.prefix,
			});
			yield* offerAll(
				backgroundRole.store,
				[0, 1, 2].flatMap((n) => [
					entry(interactive, "user:a", "pa", n),
					entry(background, "user:a", "pa", n),
				]),
			);

			expect(yield* lanesTaken(backgroundRole.store)).toEqual([background, background, background]);
			expect(yield* lanesTaken(interactiveRole.store)).toEqual([
				interactive,
				interactive,
				interactive,
			]);
		}),
	);

	test.effect("execution_lanes_preserve_interactive_headroom_and_background_progress", () =>
		Effect.gen(function* () {
			const capacity = { total: 2, background: 1 };

			const idle = yield* makeTestStore({ capacity });
			const first = yield* holdTake(idle.store);
			const second = yield* holdTake(idle.store);
			yield* Effect.yieldNow;
			yield* offerAll(idle.store, [
				entry(background, "user:a", "p", 0),
				entry(background, "user:a", "p", 1),
			]);
			const firstItem = yield* Deferred.await(first.received).pipe(Effect.timeout("10 seconds"));
			yield* settle;
			expect(yield* decodeEntry(firstItem.element)).toMatchObject({ n: 0, lane: background });
			expect(yield* Deferred.isDone(second.received)).toBe(false);
			expect(idle.inflight(queueName)).toEqual({ background: 1, interactive: 0 });
			expect(yield* call(() => idle.client.scard(idle.keys.pending))).toBe(1);
			yield* offerAll(idle.store, [entry(interactive, "user:b", "p", 2)]);
			const secondItem = yield* Deferred.await(second.received).pipe(Effect.timeout("10 seconds"));
			expect(yield* decodeEntry(secondItem.element)).toMatchObject({ n: 2, lane: interactive });
			expect(idle.inflight(queueName)).toEqual({ background: 1, interactive: 1 });
			yield* Deferred.succeed(first.finish, undefined);
			yield* Deferred.succeed(second.finish, undefined);
			yield* Fiber.join(first.fiber);
			yield* Fiber.join(second.fiber);
			expect(idle.inflight(queueName)).toEqual({ background: 0, interactive: 0 });

			yield* withIsolatedRegistry(
				Effect.gen(function* () {
					const starving = yield* makeTestStore({ capacity });
					yield* offerAll(starving.store, [
						...Array.from({ length: 8 }, (_, n) => entry(interactive, "user:a", "p", n)),
						...Array.from({ length: 2 }, (_, n) => entry(background, "user:b", "p", n)),
					]);
					const order = yield* interactiveFlowOrder(starving.store, 10);
					expect(order.map((item) => item.lane)).toEqual([
						...Array.from({ length: 4 }, () => interactive),
						background,
						...Array.from({ length: 4 }, () => interactive),
						background,
					]);
					const snapshots = yield* Metric.snapshot;
					const series = (id: string, lane: string) =>
						snapshots.find(
							(snapshot) => snapshot.id === id && snapshot.attributes?.["lane"] === lane,
						)?.state;
					expect(series("ryot.durable_queue.dispatches", interactive)).toMatchObject({ count: 8 });
					expect(series("ryot.durable_queue.dispatches", background)).toMatchObject({ count: 2 });
					expect(series("ryot.durable_queue.wait_duration", interactive)).toMatchObject({
						count: 8,
					});
					expect(series("ryot.durable_queue.wait_duration", background)).toMatchObject({
						count: 2,
					});
				}),
			);

			const long = yield* makeTestStore({ capacity });
			yield* offerAll(long.store, [
				entry(background, "user:a", "p", 0),
				entry(background, "user:b", "p", 1),
			]);
			const running = yield* holdTake(long.store);
			yield* Deferred.await(running.received).pipe(Effect.timeout("10 seconds"));
			yield* offerAll(
				long.store,
				Array.from({ length: 10 }, (_, n) => entry(interactive, "user:c", "p", n)),
			);
			const during = yield* interactiveFlowOrder(long.store, 4);
			expect(during.map((item) => item.lane)).toEqual(Array.from({ length: 4 }, () => interactive));
			yield* Deferred.succeed(running.finish, undefined);
			yield* Fiber.join(running.fiber);
			const after = yield* interactiveFlowOrder(long.store, 5);
			expect(after[0]?.lane).toBe(interactive);
			expect(after.findIndex((item) => item.lane === background)).toBeLessThanOrEqual(4);
		}),
	);

	test.effect("fair_admission_releases_tickets_and_reservations_exactly_once", () =>
		Effect.gen(function* () {
			const { keys, store, client, prefix, inflight } = yield* makeTestStore();
			const idle = yield* redisSnapshot(client, prefix);
			const element = entry(interactive, "user:a", "p", 0);
			const queued = entry(interactive, "user:a", "p", 1);
			const id = crypto.randomUUID();
			yield* store.offer({ id, element, name: queueName, isCustomId: false });
			const offered = yield* redisSnapshot(client, prefix);
			const flow = yield* call(() => client.hget(keys.flows, id));

			const interrupted = yield* holdTake(store);
			yield* Deferred.await(interrupted.received);
			expect(inflight(queueName)).toEqual({ background: 0, interactive: 1 });
			yield* Fiber.interrupt(interrupted.fiber);
			expect(inflight(queueName)).toEqual({ background: 0, interactive: 0 });
			expect(yield* redisSnapshot(client, prefix)).toEqual(offered);

			yield* store.offer({
				element: queued,
				name: queueName,
				isCustomId: false,
				id: crypto.randomUUID(),
			});
			const failing = yield* holdTake(store);
			expect((yield* Deferred.await(failing.received)).id).toBe(id);
			yield* Deferred.fail(failing.finish, "boom");
			yield* Fiber.await(failing.fiber);
			expect(inflight(queueName)).toEqual({ background: 0, interactive: 0 });
			const retry = yield* holdTake(store);
			const retried = yield* Deferred.await(retry.received);
			expect({ id: retried.id, attempts: retried.attempts }).toEqual({ id, attempts: 2 });
			expect(yield* call(() => client.hget(keys.flows, id))).toBe(flow);
			yield* Deferred.succeed(retry.finish, undefined);
			yield* Fiber.join(retry.fiber);
			expect((yield* takeThenComplete(store)).element).toEqual(queued);
			expect(inflight(queueName)).toEqual({ background: 0, interactive: 0 });
			expect(yield* redisSnapshot(client, prefix)).toEqual(idle);

			const failingPoll = yield* makeTestStore();
			const waiting = yield* holdTake(failingPoll.store);
			yield* call(() => failingPoll.client.set(failingPoll.keys.delayed, "not-a-sorted-set"));
			yield* offerAll(failingPoll.store, [element]);
			const beforeRecovery = yield* redisSnapshot(failingPoll.client, failingPoll.prefix);
			yield* Effect.sleep(700);
			expect(yield* Deferred.isDone(waiting.received)).toBe(false);
			expect(failingPoll.inflight(queueName)).toEqual({ background: 0, interactive: 0 });
			expect(yield* redisSnapshot(failingPoll.client, failingPoll.prefix)).toEqual(beforeRecovery);
			yield* call(() => failingPoll.client.del(failingPoll.keys.delayed));
			const recovered = yield* Deferred.await(waiting.received).pipe(Effect.timeout("10 seconds"));
			expect(recovered.element).toEqual(element);
			expect(failingPoll.inflight(queueName)).toEqual({ background: 0, interactive: 1 });
			yield* Deferred.succeed(waiting.finish, undefined);
			yield* Fiber.join(waiting.fiber);
			expect(failingPoll.inflight(queueName)).toEqual({ background: 0, interactive: 0 });
		}),
	);

	test.effect("fair_queue_redispatches_expired_peer_locks", () =>
		Effect.gen(function* () {
			const prefix = `ryot:test:fair:${crypto.randomUUID()}:`;
			const peer = yield* makeTestStore({
				prefix,
				lockExpiration: 150,
				lockRefreshInterval: Duration.hours(1),
			});
			const survivor = yield* makeTestStore({
				prefix,
				lockRefreshInterval: 50,
				lockExpiration: Duration.minutes(1),
			});
			const flowElement = entry(interactive, "user:a", "p", 0);
			const next = entry(interactive, "user:a", "p", 1);
			yield* offerAll(survivor.store, [entry(interactive, "user:z", "warmup", 9)]);
			yield* takeThenComplete(survivor.store);
			const id = crypto.randomUUID();
			yield* peer.store.offer({ id, name: queueName, isCustomId: false, element: flowElement });
			yield* offerAll(peer.store, [next]);
			const beforeTake = yield* redisSnapshot(peer.client, prefix);

			const stalled = yield* holdTake(peer.store);
			expect((yield* Deferred.await(stalled.received)).attempts).toBe(1);
			yield* eventually(
				Effect.map(
					call(() => peer.client.scard(peer.keys.pending)),
					(pending) => pending === 0,
				),
			);
			expect(yield* redisSnapshot(peer.client, prefix)).toEqual({
				...beforeTake,
				[peer.keys.attempts]: { [id]: "1" },
			});

			const redispatched = yield* takeThenComplete(survivor.store);
			expect({ id: redispatched.id, attempts: redispatched.attempts }).toEqual({ id, attempts: 2 });
			expect((yield* takeThenComplete(survivor.store)).element).toEqual(next);
			yield* Fiber.interrupt(stalled.fiber);
			expect(peer.inflight(queueName)).toEqual({ background: 0, interactive: 0 });
			expect(yield* redisSnapshot(peer.client, prefix)).toEqual({});
		}),
	);

	test.effect(
		"fair queue store matches the persisted queue contract for ids, failures, cleanup and restart",
		() =>
			Effect.gen(function* () {
				const { keys, store, client, prefix } = yield* makeTestStore();
				const element = entry(interactive, "user:a", "p", 0);
				const offerCustom = (id: string) =>
					store.offer({ id, element, name: queueName, isCustomId: true });

				yield* offerCustom("custom");
				yield* offerCustom("custom");
				expect(yield* call(() => client.hlen(keys.items))).toBe(1);
				yield* takeThenComplete(store);
				yield* offerCustom("custom");
				expect(yield* call(() => client.hlen(keys.items))).toBe(0);

				yield* Effect.sleep(5);
				yield* store.cleanup({ timeToLive: Duration.zero, failedTimeToLive: undefined });
				expect(yield* redisSnapshot(client, prefix)).toEqual({});
				yield* offerCustom("custom");
				expect(yield* call(() => client.hlen(keys.items))).toBe(1);
				yield* takeThenComplete(store);
				yield* Effect.sleep(5);
				yield* store.cleanup({ timeToLive: Duration.zero, failedTimeToLive: undefined });

				yield* offerCustom("doomed");
				for (const attempt of [1, 2]) {
					const doomed = yield* holdTake(store, 2);
					expect((yield* Deferred.await(doomed.received)).attempts).toBe(attempt);
					yield* Deferred.fail(doomed.finish, "boom");
					yield* Fiber.await(doomed.fiber);
				}
				const failedRecords = yield* call(() => client.lrange(keys.failed, 0, -1));
				expect(failedRecords.map((record) => JSON.parse(record))).toMatchObject([
					{ element, attempts: 2, id: "doomed" },
				]);
				expect(yield* redisSnapshot(client, prefix)).toEqual({
					[keys.failed]: failedRecords,
					[keys.ids]: ["doomed", "inf"],
				});
				yield* Effect.sleep(5);
				yield* store.cleanup({ timeToLive: Duration.zero, failedTimeToLive: Duration.zero });
				expect(yield* redisSnapshot(client, prefix)).toEqual({});

				const crashed = yield* Scope.make();
				const crashedStore = yield* makeFairQueueStore(
					storeOptions(prefix, { lockExpiration: 100, lockRefreshInterval: Duration.hours(1) }),
				).pipe(Scope.provide(crashed));
				yield* offerAll(crashedStore.store, [element]);
				const lost = yield* holdTake(crashedStore.store);
				const { id } = yield* Deferred.await(lost.received);
				yield* Scope.close(crashed, Exit.void);
				yield* Effect.sleep(200);
				const restarted = yield* makeTestStore({ prefix });
				const resumed = yield* takeThenComplete(restarted.store);
				expect({ id: resumed.id, attempts: resumed.attempts }).toEqual({ id, attempts: 2 });
			}),
	);
});
