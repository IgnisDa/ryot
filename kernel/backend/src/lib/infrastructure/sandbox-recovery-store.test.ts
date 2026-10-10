import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { testExecutionId, testRedisUrl } from "#lib/test-utils/redis";

import { redisKeys, RedisService } from "./redis";
import { SandboxRecoveryStore, SandboxRecoveryStoreError } from "./sandbox-recovery-store";

const storeLayer = Layer.unwrap(
	Effect.sync(() =>
		SandboxRecoveryStore.layer.pipe(
			Layer.provideMerge(RedisService.layer),
			Layer.provide(makeAppConfigLayer({ redisUrl: Redacted.make(testRedisUrl()) })),
		),
	),
);

const acquireIdentity = Effect.acquireRelease(
	Effect.sync(() => ({
		pinHash: "a".repeat(64),
		executionId: testExecutionId("recovery"),
		instance: `instance-${crypto.randomUUID()}`,
	})),
	({ executionId }) =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			yield* redis.del(redisKeys.sandboxRecovery(executionId));
		}),
);

layer(storeLayer)((test) => {
	test.effect("counts concurrent distinct and duplicate collateral events atomically", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxRecoveryStore;
				const redis = yield* RedisService;
				const identity = yield* acquireIdentity;
				yield* Effect.all(
					[
						store.collateral(identity, "event-1"),
						store.collateral(identity, "event-1"),
						store.collateral(identity, "event-2"),
						store.collateral(identity, "event-2"),
						store.collateral(identity, "event-3"),
						store.collateral(identity, "event-3"),
					],
					{ concurrency: "unbounded" },
				);
				expect(yield* store.read(identity)).toEqual({ recoveries: 3, suspended: false });
				yield* Effect.all(
					[store.collateral(identity, "event-4"), store.collateral(identity, "event-4")],
					{ concurrency: "unbounded" },
				);
				expect(yield* store.read(identity)).toEqual({ recoveries: 3, suspended: true });
				yield* Effect.all(
					Array.from({ length: 20 }, (_, index) =>
						store.collateral(identity, `event-${index + 5}`),
					),
					{ concurrency: "unbounded" },
				);
				expect(
					yield* Effect.promise(() =>
						redis.client.hlen(redisKeys.sandboxRecovery(identity.executionId)),
					),
				).toBe(8);
			}),
		),
	);
	test.effect("keeps recovery state durable across service reconstruction without a TTL", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxRecoveryStore;
				const redis = yield* RedisService;
				const identity = yield* acquireIdentity;
				yield* store.collateral(identity, "event-1");
				yield* store.collateral(identity, "event-2");
				const reconstructedStore = yield* SandboxRecoveryStore.make;
				const persistedState = yield* reconstructedStore.read(identity);
				expect(persistedState).toEqual({ recoveries: 2, suspended: false });
				expect(
					yield* Effect.promise(() =>
						redis.client.pttl(redisKeys.sandboxRecovery(identity.executionId)),
					),
				).toBe(-1);
			}),
		),
	);
	test.effect("rejects identity mismatches, wrong Redis types, and corrupt hash fields", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxRecoveryStore;
				const redis = yield* RedisService;
				const identity = yield* acquireIdentity;
				yield* store.read(identity);
				const wrongInstance = yield* Effect.exit(
					store.read({ ...identity, instance: "other-instance" }),
				);
				assertExitFails(
					wrongInstance,
					new SandboxRecoveryStoreError({ message: "Recovery identity mismatch" }),
				);
				const wrongPin = yield* Effect.exit(store.clear({ ...identity, pinHash: "b".repeat(64) }));
				assertExitFails(
					wrongPin,
					new SandboxRecoveryStoreError({ message: "Recovery identity mismatch" }),
				);
				yield* Effect.tryPromise(() =>
					redis.client.hset(redisKeys.sandboxRecovery(identity.executionId), "recoveries", "4"),
				);
				const corruptFields = yield* Effect.exit(store.read(identity));
				assertExitFails(
					corruptFields,
					new SandboxRecoveryStoreError({ message: "Recovery store is corrupt" }),
				);
				yield* redis.del(redisKeys.sandboxRecovery(identity.executionId));
				yield* redis.set(redisKeys.sandboxRecovery(identity.executionId), "wrong-type");
				const wrongType = yield* Effect.exit(store.read(identity));
				assertExitFails(
					wrongType,
					new SandboxRecoveryStoreError({ message: "Recovery store is corrupt" }),
				);
			}),
		),
	);
	test.effect("requires fresh healthy epochs and preserves the recovery budget", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxRecoveryStore;
				const identity = yield* acquireIdentity;
				for (const eventId of ["event-1", "event-2", "event-3", "event-4"]) {
					yield* store.collateral(identity, eventId);
				}
				expect(yield* store.resume(identity, "healthy-1")).toEqual({
					recoveries: 3,
					suspended: false,
				});
				expect(yield* store.collateral(identity, "event-4")).toEqual({
					recoveries: 3,
					suspended: false,
				});
				expect(yield* store.collateral(identity, "event-5")).toEqual({
					recoveries: 3,
					suspended: true,
				});
				expect(yield* store.resume(identity, "healthy-1")).toEqual({
					recoveries: 3,
					suspended: true,
				});
				expect(yield* store.resume(identity, "healthy-2")).toEqual({
					recoveries: 3,
					suspended: false,
				});
			}),
		),
	);
	test.effect("clears only matching identities and is idempotent when absent", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxRecoveryStore;
				const identity = yield* acquireIdentity;
				yield* store.collateral(identity, "event-1");
				const wrongOwner = yield* Effect.exit(
					store.clear({ ...identity, instance: "other-instance" }),
				);
				assertExitFails(
					wrongOwner,
					new SandboxRecoveryStoreError({ message: "Recovery identity mismatch" }),
				);
				expect(yield* store.read(identity)).toEqual({ recoveries: 1, suspended: false });
				expect(yield* store.clear(identity)).toEqual({ recoveries: 0, suspended: false });
				expect(yield* store.clear(identity)).toEqual({ recoveries: 0, suspended: false });
			}),
		),
	);
	test.effect("rejects empty identities, collateral events, epochs, and invalid pin hashes", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const store = yield* SandboxRecoveryStore;
				const identity = yield* acquireIdentity;
				const invalidIdentity = yield* Effect.exit(store.read({ ...identity, executionId: "" }));
				assertExitFails(
					invalidIdentity,
					new SandboxRecoveryStoreError({ message: "Invalid recovery identity" }),
				);
				const invalidInstance = yield* Effect.exit(store.read({ ...identity, instance: "" }));
				assertExitFails(
					invalidInstance,
					new SandboxRecoveryStoreError({ message: "Invalid recovery identity" }),
				);
				const invalidPin = yield* Effect.exit(store.read({ ...identity, pinHash: "A".repeat(64) }));
				assertExitFails(
					invalidPin,
					new SandboxRecoveryStoreError({ message: "Invalid recovery identity" }),
				);
				const invalidEvent = yield* Effect.exit(store.collateral(identity, ""));
				assertExitFails(
					invalidEvent,
					new SandboxRecoveryStoreError({ message: "Invalid recovery event" }),
				);
				const invalidEpoch = yield* Effect.exit(store.resume(identity, ""));
				assertExitFails(
					invalidEpoch,
					new SandboxRecoveryStoreError({ message: "Invalid recovery epoch" }),
				);
			}),
		),
	);
});
