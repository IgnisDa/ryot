import { assert, expect, layer } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { testExecutionId, testRedisUrl } from "#lib/test-utils/redis";

import { redisKeys, RedisService } from "./redis";
import { SandboxCrashStore, SandboxCrashStoreError } from "./sandbox-crash-store";

const storeLayer = Layer.unwrap(
	Effect.sync(() =>
		SandboxCrashStore.layer.pipe(
			Layer.provideMerge(RedisService.layer),
			Layer.provide(makeAppConfigLayer({ redisUrl: Redacted.make(testRedisUrl()) })),
		),
	),
);

const identities = Effect.acquireRelease(
	Effect.sync(() => [testExecutionId("owner"), testExecutionId("content")]),
	(keys) =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			yield* redis.del(
				...keys.flatMap((key) => [
					redisKeys.sandboxCrashWindow(key),
					redisKeys.sandboxQuarantine(key),
					redisKeys.sandboxProbation(key),
					redisKeys.sandboxProbationLease(key),
				]),
			);
		}),
);

layer(storeLayer)((test) => {
	test.effect("counts distinct crashes atomically and blocks owner and content rotation", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxCrashStore;
				const redis = yield* RedisService;
				const keys = yield* identities;
				yield* store.strike(keys, "crash-1");
				yield* store.strike(keys, "crash-1");
				yield* store.strike(keys, "crash-2");
				expect(yield* store.acquire(keys, "run-1")).toBe("allowed");
				yield* store.strike(keys, "crash-3");
				for (const key of keys) {
					expect(yield* store.acquire([key], "rotation")).toBe("blocked");
					const ttl = yield* Effect.promise(() =>
						redis.client.pttl(redisKeys.sandboxQuarantine(key)),
					);
					expect(ttl).toBeGreaterThan(3_500_000);
					expect(ttl).toBeLessThanOrEqual(3_600_000);
				}
			}),
		),
	);
	test.effect("removes strikes outside the ten-minute window before counting", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxCrashStore;
				const redis = yield* RedisService;
				const keys = yield* identities;
				for (const key of keys) {
					yield* redis.zadd(redisKeys.sandboxCrashWindow(key), 0, "expired-crash");
				}
				yield* store.strike(keys, "crash-1");
				yield* store.strike(keys, "crash-2");
				expect(yield* store.acquire(keys, "run")).toBe("allowed");
			}),
		),
	);
	test.effect("allows one probation owner and preserves probation after cancellation", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxCrashStore;
				const redis = yield* RedisService;
				const keys = yield* identities;
				for (const key of keys) {
					yield* redis.set(redisKeys.sandboxProbation(key), "1");
				}
				const results = yield* Effect.all(
					[store.acquire(keys, "first"), store.acquire(keys, "second")],
					{ concurrency: "unbounded" },
				);
				expect(results.filter((result) => result === "probation")).toHaveLength(1);
				expect(results.filter((result) => result === "blocked")).toHaveLength(1);
				const owner = results[0] === "probation" ? "first" : "second";
				expect(yield* store.survived(keys, "foreign")).toBe("stale");
				expect(yield* store.acquire(keys, "third")).toBe("blocked");
				yield* store.release(keys, owner);
				expect(yield* store.acquire(keys, "third")).toBe("probation");
				yield* store.survived(keys, "third");
				expect(yield* store.acquire(keys, "fourth")).toBe("allowed");
			}),
		),
	);
	test.effect("renews quarantine when an exclusive probation execution crashes", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxCrashStore;
				const redis = yield* RedisService;
				const keys = yield* identities;
				for (const key of keys) {
					yield* redis.set(redisKeys.sandboxProbation(key), "1");
				}
				expect(yield* store.acquire(keys, "probe")).toBe("probation");
				yield* store.strike(keys, "probe-crash");
				expect(yield* store.acquire(keys, "next")).toBe("blocked");
				expect(yield* store.survived(keys, "probe")).toBe("stale");
			}),
		),
	);
	test.effect("fails closed when persisted protection state is corrupt", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxCrashStore;
				const redis = yield* RedisService;
				const keys = yield* identities;
				const [identity] = keys;
				assert(identity !== undefined);
				yield* redis.set(redisKeys.sandboxProbation(identity), "invalid");
				const exit = yield* Effect.exit(store.acquire(keys, "run"));
				assertExitFails(exit, new SandboxCrashStoreError({ message: "Crash store is corrupt" }));
			}),
		),
	);
});
