import { it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber, Layer, Queue, Ref } from "effect";
import { describe, expect } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";
import { makeRedisService } from "#lib/test-utils/effect";

import { SANDBOX_LIMITS } from "./limits";
import { BridgeService, withSandboxHostCallPermit } from "./runtime";
import { apiSuccess } from "./shared";

const makeBridgeLayer = () => {
	const values = new Map<string, string>();
	const redis = makeRedisService({
		get: (key) => Effect.sync(() => values.get(key) ?? null),
		set: (key, value) => Effect.sync(() => values.set(key, value)).pipe(Effect.asVoid),
		del: (...keys) =>
			Effect.sync(() => {
				let deleted = 0;
				for (const key of keys) {
					deleted += Number(values.delete(key));
				}
				return deleted;
			}),
	});
	return BridgeService.Default.pipe(Layer.provide(Layer.succeed(RedisService, redis)));
};

const addSession = Effect.fn("test.addSession")(function* (
	bridge: BridgeService,
	executionId: string,
	host: () => Effect.Effect<unknown, unknown>,
) {
	const parentSpan = yield* Effect.currentSpan;
	const now = yield* Clock.currentTimeMillis;
	yield* bridge.addSession(executionId, {
		parentSpan,
		expiresAt: now + 60_000,
		token: `${executionId}-token`,
		apiFunctions: { test: () => host() },
		hostCallLimit: SANDBOX_LIMITS.hostCalls.total,
	});
});

const requestBridge = (bridge: BridgeService, executionId: string) =>
	fetch(`http://127.0.0.1:${bridge.port}/rpc/${executionId}/test`, {
		method: "POST",
		body: '{"args":[]}',
		headers: { authorization: `Bearer ${executionId}-token` },
	});

const call = (bridge: BridgeService, executionId: string) =>
	Effect.tryPromise(() => requestBridge(bridge, executionId));

describe("sandbox bridge host-call concurrency", () => {
	it.scoped("bounds queued calls and isolates execution ids", () =>
		Effect.gen(function* () {
			const bridge = yield* BridgeService;
			const active = yield* Ref.make(0);
			const maximum = yield* Ref.make(0);
			const started = yield* Queue.unbounded<void>();
			const release = yield* Queue.unbounded<void>();
			const host = () =>
				Ref.updateAndGet(active, (value) => value + 1).pipe(
					Effect.tap((value) => Ref.update(maximum, (current) => Math.max(current, value))),
					Effect.tap(() => started.offer(undefined)),
					Effect.zipRight(release.take),
					Effect.as(apiSuccess(null)),
					Effect.ensuring(Ref.update(active, (value) => value - 1)),
				);
			yield* addSession(bridge, "first", host);
			yield* addSession(bridge, "second", () => Effect.succeed(apiSuccess(null)));

			const calls = yield* Effect.forEach(
				Array.from({ length: SANDBOX_LIMITS.bridge.concurrentHostCalls + 1 }),
				() => Effect.fork(call(bridge, "first")),
			);
			yield* Effect.replicateEffect(started.take, SANDBOX_LIMITS.bridge.concurrentHostCalls);
			expect(yield* Ref.get(maximum)).toBe(SANDBOX_LIMITS.bridge.concurrentHostCalls);

			const isolated = yield* call(bridge, "second");
			expect(isolated.status).toBe(200);
			yield* release.offer(undefined);
			yield* started.take;
			expect(yield* Ref.get(maximum)).toBe(SANDBOX_LIMITS.bridge.concurrentHostCalls);

			yield* release.offerAll(
				Array.from({ length: SANDBOX_LIMITS.bridge.concurrentHostCalls }, () => undefined),
			);
			const responses = yield* Effect.forEach(calls, Fiber.join);
			expect(responses.every(({ status }) => status === 200)).toBe(true);
		}).pipe(Effect.withSpan("runtime-concurrency-test"), Effect.provide(makeBridgeLayer())),
	);

	it.scoped(
		"releases permits on every exit and ends queued calls when the session is removed",
		() =>
			Effect.gen(function* () {
				const bridge = yield* BridgeService;
				const started = yield* Queue.unbounded<void>();
				const release = yield* Deferred.make<void>();
				yield* addSession(bridge, "removed", () =>
					started
						.offer(undefined)
						.pipe(Effect.zipRight(Deferred.await(release)), Effect.as(apiSuccess(null))),
				);

				const calls = yield* Effect.forEach(
					Array.from({ length: SANDBOX_LIMITS.bridge.concurrentHostCalls + 1 }),
					() => Effect.fork(call(bridge, "removed")),
				);
				yield* Effect.replicateEffect(started.take, SANDBOX_LIMITS.bridge.concurrentHostCalls);
				yield* bridge.removeSession("removed");
				const responses = yield* Effect.forEach(calls, Fiber.join);

				expect(responses.filter(({ status }) => status === 410)).toHaveLength(
					SANDBOX_LIMITS.bridge.concurrentHostCalls,
				);
				expect(responses.every(({ status }) => status === 404 || status === 410)).toBe(true);
				expect(yield* Queue.size(started)).toBe(0);
			}).pipe(Effect.withSpan("runtime-removal-test"), Effect.provide(makeBridgeLayer())),
	);

	it.effect("releases permits after typed failure, defect, timeout, and cancellation", () =>
		Effect.gen(function* () {
			const semaphore = yield* Effect.makeSemaphore(1);
			for (const exit of [
				Effect.fail("expected failure"),
				Effect.die("expected defect"),
				Effect.never.pipe(Effect.timeoutFail({ duration: 0, onTimeout: () => "expected timeout" })),
			]) {
				yield* withSandboxHostCallPermit(semaphore, exit).pipe(Effect.exit);
				expect(yield* withSandboxHostCallPermit(semaphore, Effect.succeed("released"))).toBe(
					"released",
				);
			}

			const started = yield* Deferred.make<void>();
			const fiber = yield* withSandboxHostCallPermit(
				semaphore,
				Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never)),
			).pipe(Effect.fork);
			yield* Deferred.await(started);
			yield* Fiber.interrupt(fiber);
			expect(yield* withSandboxHostCallPermit(semaphore, Effect.succeed("released"))).toBe(
				"released",
			);
		}),
	);
});
