import { expect, it } from "@effect/vitest";
import { NotFound } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { Clock, Effect, Layer } from "effect";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe } from "vitest";

import {
	ENTITY_INTEREST_PROGRESSION_LEASE_SECONDS,
	ENTITY_INTEREST_STREAM_RENEWAL_INTERVAL_SECONDS,
	ENTITY_INTEREST_STREAM_TTL_SECONDS,
	redisKeys,
	RedisService,
} from "#lib/infrastructure/redis";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeRedisService } from "#lib/test-utils/effect";

import { EntityInterestStore } from "./store";

describe("entity interest Redis keys", () => {
	it("uses stable keys for stream ownership and reverse interest", () => {
		expect(redisKeys.entityInterestStream("stream-1")).toBe("ryot:entity-interest:stream:stream-1");
		expect(redisKeys.entityInterestStreamEntities("stream-1")).toBe(
			"ryot:entity-interest:stream:stream-1:entities",
		);
		expect(redisKeys.entityInterestStreams("entity-1")).toBe(
			"ryot:entity-interest:entity:entity-1:streams",
		);
		expect(redisKeys.entityInterestProgressionLease("entity-1")).toBe(
			"ryot:entity-interest:progress:entity-1",
		);
	});

	it("uses the ownership timing bounds", () => {
		expect(ENTITY_INTEREST_STREAM_TTL_SECONDS).toBe(15 * 60);
		expect(ENTITY_INTEREST_STREAM_RENEWAL_INTERVAL_SECONDS).toBe(5 * 60);
		expect(ENTITY_INTEREST_PROGRESSION_LEASE_SECONDS).toBe(30);
	});
});

const testRedisUrl = Bun.env["ENTITY_INTEREST_TEST_REDIS_URL"];
const redis = new Redis(testRedisUrl ?? "redis://127.0.0.1:6379/15", { lazyConnect: true });
const storeLayer = Layer.provideMerge(
	EntityInterestStore.layer,
	Layer.succeed(RedisService, makeRedisService({ client: redis })),
);
const userId = UserId.make("user-1");
const otherUserId = UserId.make("user-2");
const redisCommand = <A>(command: () => Promise<A>) =>
	Effect.tryPromise(command).pipe(Effect.orDie);

describe.skipIf(testRedisUrl === undefined)("EntityInterestStore Redis", () => {
	afterAll(() => redis.quit());
	beforeAll(() => redis.connect());
	afterEach(() => redis.flushdb());

	it.effect("claims a new stream once and stores metadata without memberships", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* store.openStream({ streamId: "stream-1", userId, preferredLanguage: null });

			expect(
				yield* redisCommand(() => redis.hgetall(redisKeys.entityInterestStream("stream-1"))),
			).toEqual({ generation: "0", preferredLanguage: "", userId: "user-1" });
			expect(
				yield* redisCommand(() => redis.exists(redisKeys.entityInterestStreamEntities("stream-1"))),
			).toBe(0);

			const duplicate = yield* Effect.exit(
				store.openStream({ streamId: "stream-1", userId, preferredLanguage: "es" }),
			);
			assertExitFails(duplicate, new NotFound({ message: "Unknown stream" }));
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("preserves current states and returns every pending member on replacement", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* store.openStream({ streamId: "stream-1", userId, preferredLanguage: null });
			const first = yield* store.replaceInterest({
				userId,
				streamId: "stream-1",
				preferredLanguage: "es",
				entityIds: ["watching", "failed-pending"],
			});
			expect(first).toEqual({
				generation: 1,
				pendingEntityIds: ["watching", "failed-pending"],
			});
			expect(
				yield* store.markReconciled({
					streamId: "stream-1",
					entityIds: ["watching"],
					generation: first.generation,
				}),
			).toBe(true);
			yield* redisCommand(() =>
				redis
					.multi()
					.zadd(redisKeys.entityInterestStreams("watching"), 0, "stream-1")
					.zadd(redisKeys.entityInterestStreams("failed-pending"), 0, "stream-1")
					.exec(),
			);
			const replacementStartedAt = yield* Clock.currentTimeMillis;

			const second = yield* store.replaceInterest({
				userId,
				streamId: "stream-1",
				preferredLanguage: "fr",
				entityIds: ["watching", "failed-pending", "new-pending"],
			});
			expect(second).toEqual({
				generation: 2,
				pendingEntityIds: ["failed-pending", "new-pending"],
			});
			expect(
				yield* redisCommand(() =>
					redis.hgetall(redisKeys.entityInterestStreamEntities("stream-1")),
				),
			).toEqual({
				watching: "watching",
				"new-pending": "pending",
				"failed-pending": "pending",
			});
			expect(
				Number(
					yield* redisCommand(() =>
						redis.zscore(redisKeys.entityInterestStreams("watching"), "stream-1"),
					),
				),
			).toBeGreaterThan(replacementStartedAt);
			expect(
				Number(
					yield* redisCommand(() =>
						redis.zscore(redisKeys.entityInterestStreams("failed-pending"), "stream-1"),
					),
				),
			).toBeGreaterThan(replacementStartedAt);

			expect(
				yield* store.markReconciled({
					streamId: "stream-1",
					generation: first.generation,
					entityIds: ["failed-pending"],
				}),
			).toBe(false);
			expect(
				yield* redisCommand(() =>
					redis.hget(redisKeys.entityInterestStreamEntities("stream-1"), "failed-pending"),
				),
			).toBe("pending");
			expect(
				yield* store.markReconciled({
					streamId: "stream-1",
					generation: second.generation,
					entityIds: ["failed-pending", "new-pending", "missing"],
				}),
			).toBe(true);

			const third = yield* store.replaceInterest({
				userId,
				streamId: "stream-1",
				preferredLanguage: "fr",
				entityIds: ["failed-pending", "new-pending"],
			});
			expect(third).toEqual({ generation: 3, pendingEntityIds: [] });
			expect(yield* store.hasInterest("stream-1", "watching")).toBe(false);
			expect(
				yield* redisCommand(() =>
					redis.zscore(redisKeys.entityInterestStreams("watching"), "stream-1"),
				),
			).toBeNull();

			const wrongOwner = yield* Effect.exit(
				store.replaceInterest({
					entityIds: [],
					userId: otherUserId,
					streamId: "stream-1",
					preferredLanguage: null,
				}),
			);
			assertExitFails(wrongOwner, new NotFound({ message: "Unknown stream" }));
			const missing = yield* Effect.exit(
				store.replaceInterest({
					userId,
					entityIds: [],
					streamId: "missing",
					preferredLanguage: null,
				}),
			);
			assertExitFails(missing, new NotFound({ message: "Unknown stream" }));

			expect(yield* store.getStreamMetadata(["stream-1", "missing"])).toEqual([
				{
					generation: 3,
					userId: "user-1",
					streamId: "stream-1",
					preferredLanguage: "fr",
				},
			]);
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("bounds memberships at 500", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* store.openStream({ streamId: "stream-1", userId, preferredLanguage: null });
			const result = yield* store.replaceInterest({
				userId,
				streamId: "stream-1",
				preferredLanguage: null,
				entityIds: Array.from({ length: 501 }, (_, index) => `entity-${index}`),
			});

			expect(result.pendingEntityIds).toHaveLength(500);
			expect(
				yield* redisCommand(() => redis.hlen(redisKeys.entityInterestStreamEntities("stream-1"))),
			).toBe(500);
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("marks captured current memberships pending for a later declaration", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			for (const streamId of ["stream-1", "stream-2"]) {
				yield* store.openStream({ streamId, userId, preferredLanguage: null });
				const interest = yield* store.replaceInterest({
					userId,
					streamId,
					entityIds: ["entity-1"],
					preferredLanguage: null,
				});
				yield* store.markReconciled({
					streamId,
					entityIds: ["entity-1"],
					generation: interest.generation,
				});
			}
			yield* store.replaceInterest({
				userId,
				streamId: "stream-2",
				entityIds: ["entity-2"],
				preferredLanguage: null,
			});

			yield* store.markPending({
				entityId: "entity-1",
				streamIds: ["stream-1", "stream-2", "missing"],
			});

			expect(
				yield* redisCommand(() =>
					redis.hget(redisKeys.entityInterestStreamEntities("stream-1"), "entity-1"),
				),
			).toBe("pending");
			expect(yield* store.hasInterest("stream-2", "entity-1")).toBe(false);
			expect(
				yield* redisCommand(() =>
					redis.hget(redisKeys.entityInterestStreamEntities("stream-2"), "entity-2"),
				),
			).toBe("pending");
			expect(
				yield* store.replaceInterest({
					userId,
					streamId: "stream-1",
					entityIds: ["entity-1"],
					preferredLanguage: null,
				}),
			).toEqual({ generation: 2, pendingEntityIds: ["entity-1"] });
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("renews active streams and treats expired renew and close as no-ops", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* store.openStream({ streamId: "stream-1", userId, preferredLanguage: null });
			yield* store.replaceInterest({
				userId,
				streamId: "stream-1",
				entityIds: ["entity-1"],
				preferredLanguage: null,
			});
			yield* redisCommand(() =>
				redis.zadd(redisKeys.entityInterestStreams("entity-1"), 0, "stream-1"),
			);
			const now = yield* Clock.currentTimeMillis;

			expect(yield* store.renewStream("stream-1")).toBe(true);
			expect(
				Number(
					yield* redisCommand(() =>
						redis.zscore(redisKeys.entityInterestStreams("entity-1"), "stream-1"),
					),
				),
			).toBeGreaterThan(now);
			expect(
				yield* redisCommand(() => redis.ttl(redisKeys.entityInterestStream("stream-1"))),
			).toBeGreaterThanOrEqual(ENTITY_INTEREST_STREAM_TTL_SECONDS - 1);

			expect(yield* store.closeStream("stream-1")).toBe(true);
			expect(yield* store.closeStream("stream-1")).toBe(false);
			expect(
				yield* redisCommand(() =>
					redis.zscore(redisKeys.entityInterestStreams("entity-1"), "stream-1"),
				),
			).toBeNull();

			yield* store.openStream({ streamId: "expired", userId, preferredLanguage: null });
			yield* store.replaceInterest({
				userId,
				streamId: "expired",
				entityIds: ["entity-2"],
				preferredLanguage: null,
			});
			yield* redisCommand(() =>
				redis.del(
					redisKeys.entityInterestStream("expired"),
					redisKeys.entityInterestStreamEntities("expired"),
				),
			);

			expect(yield* store.renewStream("expired")).toBe(false);
			expect(yield* store.closeStream("expired")).toBe(false);
			expect(yield* store.listInterestedStreams("entity-2")).toEqual([]);
			expect(
				yield* redisCommand(() =>
					redis.zscore(redisKeys.entityInterestStreams("entity-2"), "expired"),
				),
			).toBeNull();
		}).pipe(Effect.provide(storeLayer)),
	);
});
