import { it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber, Queue, Ref, Semaphore } from "effect";
import { describe, expect } from "vitest";

import { SANDBOX_LIMITS } from "./limits";
import { BridgeService, withSandboxHostCallPermit } from "./runtime";
import { apiSuccess } from "./shared";

const addSession = Effect.fn("test.addSession")(function* (
	bridge: BridgeService["Service"],
	executionId: string,
	host: () => Effect.Effect<unknown, unknown>,
	expiresAt?: number,
) {
	const parentSpan = yield* Effect.currentSpan;
	const now = yield* Clock.currentTimeMillis;
	yield* bridge.addSession(executionId, {
		parentSpan,
		token: `${executionId}-token`,
		expiresAt: expiresAt ?? now + 60_000,
		apiFunctions: { test: () => host() },
		hostCallLimit: SANDBOX_LIMITS.hostCalls.total,
	});
});

const requestBridge = (
	bridge: BridgeService["Service"],
	executionId: string,
	token = `${executionId}-token`,
) =>
	fetch(`http://127.0.0.1:${bridge.port}/rpc/${executionId}/test`, {
		method: "POST",
		body: '{"args":[]}',
		headers: { authorization: `Bearer ${token}` },
	});

const call = (bridge: BridgeService["Service"], executionId: string) =>
	Effect.tryPromise(() => requestBridge(bridge, executionId));

describe("sandbox bridge host-call concurrency", () => {
	it.effect("bounds queued calls and isolates execution ids", () =>
		Effect.gen(function* () {
			const bridge = yield* BridgeService;
			const active = yield* Ref.make(0);
			const maximum = yield* Ref.make(0);
			const started = yield* Queue.unbounded<void>();
			const release = yield* Queue.unbounded<void>();
			const host = () =>
				Ref.updateAndGet(active, (value) => value + 1).pipe(
					Effect.tap((value) => Ref.update(maximum, (current) => Math.max(current, value))),
					Effect.tap(() => Queue.offer(started, undefined)),
					Effect.andThen(Queue.take(release)),
					Effect.as(apiSuccess(null)),
					Effect.ensuring(Ref.update(active, (value) => value - 1)),
				);
			yield* addSession(bridge, "first", host);
			yield* addSession(bridge, "second", () => Effect.succeed(apiSuccess(null)));

			const calls = yield* Effect.forEach(
				Array.from({ length: SANDBOX_LIMITS.bridge.concurrentHostCalls + 1 }),
				() => Effect.forkChild(call(bridge, "first")),
			);
			yield* Effect.replicateEffect(Queue.take(started), SANDBOX_LIMITS.bridge.concurrentHostCalls);
			expect(yield* Ref.get(maximum)).toBe(SANDBOX_LIMITS.bridge.concurrentHostCalls);

			const isolated = yield* call(bridge, "second");
			expect(isolated.status).toBe(200);
			yield* Queue.offer(release, undefined);
			yield* Queue.take(started);
			expect(yield* Ref.get(maximum)).toBe(SANDBOX_LIMITS.bridge.concurrentHostCalls);

			yield* Queue.offerAll(
				release,
				Array.from({ length: SANDBOX_LIMITS.bridge.concurrentHostCalls }, () => undefined),
			);
			const responses = yield* Effect.forEach(calls, Fiber.join);
			expect(responses.every(({ status }) => status === 200)).toBe(true);
		}).pipe(Effect.withSpan("runtime-concurrency-test"), Effect.provide(BridgeService.layer)),
	);

	it.effect(
		"releases permits on every exit and ends queued calls when the session is removed",
		() =>
			Effect.gen(function* () {
				const bridge = yield* BridgeService;
				const started = yield* Queue.unbounded<void>();
				const release = yield* Deferred.make<void>();
				yield* addSession(bridge, "removed", () =>
					Queue.offer(started, undefined).pipe(
						Effect.andThen(Deferred.await(release)),
						Effect.as(apiSuccess(null)),
					),
				);

				const calls = yield* Effect.forEach(
					Array.from({ length: SANDBOX_LIMITS.bridge.concurrentHostCalls + 1 }),
					() => Effect.forkChild(call(bridge, "removed")),
				);
				yield* Effect.replicateEffect(
					Queue.take(started),
					SANDBOX_LIMITS.bridge.concurrentHostCalls,
				);
				yield* bridge.removeSession("removed");
				const responses = yield* Effect.forEach(calls, Fiber.join);

				expect(responses.filter(({ status }) => status === 410).length).toBeGreaterThanOrEqual(
					SANDBOX_LIMITS.bridge.concurrentHostCalls,
				);
				expect(responses.every(({ status }) => status === 404 || status === 410)).toBe(true);
				expect(yield* Queue.size(started)).toBe(0);
			}).pipe(Effect.withSpan("runtime-removal-test"), Effect.provide(BridgeService.layer)),
	);

	it.effect("checks in-memory session expiry and authorization", () =>
		Effect.gen(function* () {
			const bridge = yield* BridgeService;
			yield* addSession(bridge, "active", () => Effect.succeed(apiSuccess(null)));
			yield* addSession(bridge, "expired", () => Effect.succeed(apiSuccess(null)), -1);

			const missing = yield* call(bridge, "missing");
			expect(missing.status).toBe(404);

			const unauthorized = yield* Effect.tryPromise(() =>
				requestBridge(bridge, "active", "wrong-token"),
			);
			expect(unauthorized.status).toBe(401);

			const expired = yield* call(bridge, "expired");
			expect(expired.status).toBe(410);
		}).pipe(Effect.withSpan("runtime-session-test"), Effect.provide(BridgeService.layer)),
	);

	it.effect("releases permits after typed failure, defect, timeout, and cancellation", () =>
		Effect.gen(function* () {
			const semaphore = yield* Semaphore.make(1);
			for (const exit of [
				Effect.fail("expected failure"),
				Effect.die("expected defect"),
				Effect.never.pipe(
					Effect.timeoutOrElse({ duration: 0, orElse: () => Effect.fail("expected timeout") }),
				),
			]) {
				yield* withSandboxHostCallPermit(semaphore, exit).pipe(Effect.exit);
				expect(yield* withSandboxHostCallPermit(semaphore, Effect.succeed("released"))).toBe(
					"released",
				);
			}

			const started = yield* Deferred.make<void>();
			const fiber = yield* withSandboxHostCallPermit(
				semaphore,
				Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
			).pipe(Effect.forkChild);
			yield* Deferred.await(started);
			yield* Fiber.interrupt(fiber);
			expect(yield* withSandboxHostCallPermit(semaphore, Effect.succeed("released"))).toBe(
				"released",
			);
		}),
	);
});
