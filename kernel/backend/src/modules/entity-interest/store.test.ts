import { expect, it } from "@effect/vitest";
import { NotFound } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect, Layer } from "effect";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe } from "vitest";

import {
	ENTITY_INTEREST_PROGRESSION_LEASE_SECONDS,
	ENTITY_INTEREST_SESSION_RENEWAL_INTERVAL_SECONDS,
	ENTITY_INTEREST_SESSION_TTL_SECONDS,
	redisKeys,
	RedisService,
} from "#lib/infrastructure/redis";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeRedisService } from "#lib/test-utils/effect";

import { EntityInterestStore } from "./store";

describe("entity interest Redis keys", () => {
	it("uses the exact session and reverse-index keys", () => {
		expect(redisKeys.entityInterestSession("session-1")).toBe(
			"ryot:entity-interest:session:session-1",
		);
		expect(redisKeys.entityInterestSessionEntities("session-1")).toBe(
			"ryot:entity-interest:session:session-1:entities",
		);
		expect(redisKeys.entityInterestSessions("entity-1")).toBe(
			"ryot:entity-interest:entity:entity-1:sessions",
		);
		expect(redisKeys.entityInterestProgressionLease("entity-1")).toBe(
			"ryot:entity-interest:progress:entity-1",
		);
	});

	it("uses the session timing bounds", () => {
		expect(ENTITY_INTEREST_SESSION_TTL_SECONDS).toBe(15 * 60);
		expect(ENTITY_INTEREST_SESSION_RENEWAL_INTERVAL_SECONDS).toBe(5 * 60);
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
const redisCommand = <A>(command: () => Promise<A>) =>
	Effect.tryPromise(command).pipe(Effect.orDie);
const open = (store: typeof EntityInterestStore.Service, sessionId = "session-1") =>
	store.openSession({ sessionId, userId, preferredLanguage: "es" });
const pendingSorted = (pending: readonly { entityId: string; revision: number }[]) =>
	[...pending].sort((left, right) => left.entityId.localeCompare(right.entityId));

describe.skipIf(testRedisUrl === undefined)("EntityInterestStore Redis", () => {
	afterAll(() => redis.quit());
	beforeAll(() => redis.connect());
	afterEach(() => redis.flushdb());

	it.effect("opens one session with revision-zero metadata", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* open(store);

			expect(
				yield* redisCommand(() => redis.hgetall(redisKeys.entityInterestSession("session-1"))),
			).toEqual({ preferredLanguage: "es", revision: "0", userId: "user-1" });
			expect(yield* store.getSessionMetadata(["session-1", "missing"])).toEqual([
				{
					userId,
					revision: 0,
					sessionId: "session-1",
					preferredLanguage: "es",
				},
			]);

			const duplicate = yield* Effect.exit(open(store));
			assertExitFails(duplicate, new NotFound({ message: "Unknown session" }));
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("replaces membership, deduplicates IDs, and retains watching state", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* open(store);
			const first = yield* store.replaceInterest({
				revision: 1,
				sessionId: "session-1",
				entityIds: ["watching", "pending", "watching"],
			});
			expect(first.status).toBe("applied");
			if (first.status !== "applied") {
				return;
			}
			expect(pendingSorted(first.pending)).toEqual([
				{ entityId: "pending", revision: 1 },
				{ entityId: "watching", revision: 1 },
			]);
			expect(
				yield* store.markReconciled({
					sessionId: "session-1",
					pending: [{ entityId: "watching", revision: 1 }],
				}),
			).toEqual(["watching"]);

			const second = yield* store.replaceInterest({
				revision: 2,
				sessionId: "session-1",
				entityIds: ["watching", "pending", "added"],
			});
			expect(second.status).toBe("applied");
			if (second.status !== "applied") {
				return;
			}
			expect(pendingSorted(second.pending)).toEqual([
				{ entityId: "added", revision: 2 },
				{ entityId: "pending", revision: 1 },
			]);
			expect(
				yield* redisCommand(() =>
					redis.hgetall(redisKeys.entityInterestSessionEntities("session-1")),
				),
			).toEqual({ added: "pending:2", pending: "pending:1", watching: "watching" });
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("applies incremental add/remove and protects a re-added pending incarnation", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* open(store);
			yield* store.replaceInterest({ revision: 1, sessionId: "session-1", entityIds: ["a", "b"] });
			yield* store.markReconciled({
				sessionId: "session-1",
				pending: [
					{ entityId: "a", revision: 1 },
					{ entityId: "b", revision: 1 },
				],
			});
			const removed = yield* store.updateInterest({
				revision: 2,
				remove: ["a"],
				add: ["c", "c"],
				sessionId: "session-1",
			});
			expect(removed).toEqual({
				revision: 2,
				status: "applied",
				pending: [{ entityId: "c", revision: 2 }],
			});
			const readded = yield* store.updateInterest({
				add: ["a"],
				revision: 3,
				remove: ["c"],
				sessionId: "session-1",
			});
			expect(readded.status).toBe("applied");
			expect(
				yield* store.markReconciled({
					sessionId: "session-1",
					pending: [{ entityId: "a", revision: 1 }],
				}),
			).toEqual([]);
			expect(
				yield* redisCommand(() =>
					redis.hget(redisKeys.entityInterestSessionEntities("session-1"), "a"),
				),
			).toBe("pending:3");
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("removes only exact pending incarnations and their reverse indexes", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* open(store);
			yield* store.replaceInterest({
				revision: 1,
				sessionId: "session-1",
				entityIds: ["removed", "retained"],
			});

			expect(
				yield* store.removePending({
					sessionId: "session-1",
					pending: [
						{ entityId: "removed", revision: 1 },
						{ entityId: "retained", revision: 2 },
					],
				}),
			).toEqual(["removed"]);
			expect(yield* store.hasInterest("session-1", "removed")).toBe(false);
			expect(yield* store.hasInterest("session-1", "retained")).toBe(true);
			expect(
				yield* redisCommand(() =>
					redis.zscore(redisKeys.entityInterestSessions("removed"), "session-1"),
				),
			).toBeNull();
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("lists only atomically confirmed watching memberships for publication", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* open(store);
			yield* store.replaceInterest({
				revision: 1,
				sessionId: "session-1",
				entityIds: ["private-entity"],
			});

			expect(yield* store.listWatchingSessions("private-entity")).toEqual([]);
			yield* store.markReconciled({
				sessionId: "session-1",
				pending: [{ entityId: "private-entity", revision: 1 }],
			});
			expect(yield* store.listWatchingSessions("private-entity")).toEqual(["session-1"]);
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect(
		"rejects overlap, revision mismatch, missing sessions, and over-limit commands atomically",
		() =>
			Effect.gen(function* () {
				const store = yield* EntityInterestStore;
				yield* open(store);
				expect(
					yield* store.updateInterest({
						revision: 1,
						add: ["same"],
						remove: ["same"],
						sessionId: "session-1",
					}),
				).toEqual({ status: "overlap" });
				expect(
					yield* store.replaceInterest({ revision: 2, sessionId: "session-1", entityIds: [] }),
				).toEqual({ status: "revision-mismatch" });
				expect(
					yield* store.replaceInterest({ revision: 1, sessionId: "missing", entityIds: [] }),
				).toEqual({ status: "missing-session" });
				expect(
					yield* store.replaceInterest({
						revision: 1,
						sessionId: "session-1",
						entityIds: Array.from({ length: 501 }, (_, index) => `entity-${index}`),
					}),
				).toEqual({ status: "limit-exceeded" });
				expect(
					yield* store.replaceInterest({
						revision: 1,
						sessionId: "session-1",
						entityIds: Array.from({ length: 500 }, (_, index) => `entity-${index}`),
					}),
				).toMatchObject({ status: "applied", revision: 1 });
				expect(
					yield* store.updateInterest({
						remove: [],
						revision: 2,
						sessionId: "session-1",
						add: ["entity-over-limit"],
					}),
				).toEqual({ status: "limit-exceeded" });
				expect(yield* store.getSessionMetadata(["session-1"])).toMatchObject([{ revision: 1 }]);
				expect(
					yield* redisCommand(() =>
						redis.hlen(redisKeys.entityInterestSessionEntities("session-1")),
					),
				).toBe(500);
				expect(yield* store.hasInterest("session-1", "entity-over-limit")).toBe(false);
			}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("supports empty final sets and allows only one concurrent command for a revision", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* open(store);
			const outcomes = yield* Effect.all(
				[
					store.replaceInterest({ revision: 1, sessionId: "session-1", entityIds: ["a"] }),
					store.replaceInterest({ revision: 1, sessionId: "session-1", entityIds: ["b"] }),
				],
				{ concurrency: "unbounded" },
			);
			expect(outcomes.map(({ status }) => status).sort()).toEqual(["applied", "revision-mismatch"]);
			expect(
				yield* store.replaceInterest({ revision: 2, sessionId: "session-1", entityIds: [] }),
			).toEqual({ status: "applied", revision: 2, pending: [] });
			expect(yield* store.hasInterest("session-1", "a")).toBe(false);
			expect(yield* store.hasInterest("session-1", "b")).toBe(false);
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("marks only current memberships pending at the current session revision", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* open(store, "session-1");
			yield* open(store, "session-2");
			for (const sessionId of ["session-1", "session-2"]) {
				yield* store.replaceInterest({ revision: 1, sessionId, entityIds: ["entity-1"] });
				yield* store.markReconciled({
					sessionId,
					pending: [{ entityId: "entity-1", revision: 1 }],
				});
			}
			yield* store.updateInterest({
				revision: 2,
				add: ["entity-2"],
				remove: ["entity-1"],
				sessionId: "session-2",
			});

			yield* store.markPending({
				entityId: "entity-1",
				sessionIds: ["session-1", "session-2", "missing"],
			});
			expect(
				yield* redisCommand(() =>
					redis.hget(redisKeys.entityInterestSessionEntities("session-1"), "entity-1"),
				),
			).toBe("pending:1");
			expect(yield* store.hasInterest("session-2", "entity-1")).toBe(false);
			expect(
				yield* redisCommand(() =>
					redis.hget(redisKeys.entityInterestSessionEntities("session-2"), "entity-2"),
				),
			).toBe("pending:2");
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("renews, closes, and prunes stale reverse entries", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* open(store);
			yield* store.replaceInterest({
				revision: 1,
				sessionId: "session-1",
				entityIds: ["entity-1"],
			});
			const now = yield* Clock.currentTimeMillis;
			expect(yield* store.renewSession("session-1")).toBe(true);
			expect(
				Number(
					yield* redisCommand(() =>
						redis.zscore(redisKeys.entityInterestSessions("entity-1"), "session-1"),
					),
				),
			).toBeGreaterThan(now);
			expect(yield* store.closeSession("session-1")).toBe(true);
			expect(yield* store.closeSession("session-1")).toBe(false);

			yield* redisCommand(() =>
				redis.zadd(redisKeys.entityInterestSessions("entity-2"), now + 60_000, "stale-session"),
			);
			expect(yield* store.listInterestedSessions("entity-2")).toEqual([]);
			expect(
				yield* redisCommand(() =>
					redis.zscore(redisKeys.entityInterestSessions("entity-2"), "stale-session"),
				),
			).toBeNull();
		}).pipe(Effect.provide(storeLayer)),
	);

	it.effect("cleans membership indexes when session metadata is already missing", () =>
		Effect.gen(function* () {
			const store = yield* EntityInterestStore;
			yield* open(store);
			yield* store.replaceInterest({
				revision: 1,
				sessionId: "session-1",
				entityIds: ["entity-1"],
			});
			yield* redisCommand(() => redis.del(redisKeys.entityInterestSession("session-1")));

			expect(yield* store.closeSession("session-1")).toBe(false);
			expect(
				yield* redisCommand(() =>
					redis.exists(redisKeys.entityInterestSessionEntities("session-1")),
				),
			).toBe(0);
			expect(
				yield* redisCommand(() =>
					redis.zscore(redisKeys.entityInterestSessions("entity-1"), "session-1"),
				),
			).toBeNull();
		}).pipe(Effect.provide(storeLayer)),
	);
});
