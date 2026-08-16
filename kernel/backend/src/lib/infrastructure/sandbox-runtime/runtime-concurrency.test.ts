import { it } from "@effect/vitest";
import { hostSuccess } from "@ryot-app/sandbox-sdk/wire";
import { Clock, Deferred, Effect, Exit, Fiber, Queue, Ref, Scope, Semaphore } from "effect";
import { describe, expect } from "vitest";

import { SANDBOX_LIMITS } from "./limits";
import { BridgeService, withSandboxHostCallPermit } from "./runtime";

const addSession = Effect.fn("test.addSession")(function* (
	bridge: BridgeService["Service"],
	executionId: string,
	host: () => Effect.Effect<unknown, unknown>,
	options: { readonly token?: string; readonly expiresAt?: number } = {},
) {
	const parentSpan = yield* Effect.currentSpan;
	const now = yield* Clock.currentTimeMillis;
	yield* bridge.addSession(executionId, {
		parentSpan,
		apiFunctions: { test: () => host() },
		token: options.token ?? `${executionId}-token`,
		expiresAt: options.expiresAt ?? now + 60_000,
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
					Effect.as(hostSuccess(null)),
					Effect.ensuring(Ref.update(active, (value) => value - 1)),
				);
			yield* addSession(bridge, "first", host);
			yield* addSession(bridge, "second", () => Effect.succeed(hostSuccess(null)));

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
		}).pipe(
			Effect.scoped,
			Effect.withSpan("runtime-concurrency-test"),
			Effect.provide(BridgeService.layer),
		),
	);

	it.effect("ends a replaced session and keeps the newer registration installed", () =>
		Effect.gen(function* () {
			const bridge = yield* BridgeService;
			const replaced = yield* Scope.make();
			const replacement = yield* Scope.make();
			const started = yield* Queue.unbounded<void>();
			yield* addSession(
				bridge,
				"duplicate",
				() => Queue.offer(started, undefined).pipe(Effect.andThen(Effect.never)),
				{ token: "replaced-token" },
			).pipe(Effect.provideService(Scope.Scope, replaced));

			const pending = yield* Effect.forkChild(
				Effect.tryPromise(() => requestBridge(bridge, "duplicate", "replaced-token")),
			);
			yield* Queue.take(started);
			yield* addSession(bridge, "duplicate", () => Effect.succeed(hostSuccess(null)), {
				token: "replacement-token",
			}).pipe(Effect.provideService(Scope.Scope, replacement));
			expect((yield* Fiber.join(pending)).status).toBe(410);

			yield* Scope.close(replaced, Exit.void);
			const stale = yield* Effect.tryPromise(() =>
				requestBridge(bridge, "duplicate", "replaced-token"),
			);
			expect(stale.status).toBe(401);
			const current = yield* Effect.tryPromise(() =>
				requestBridge(bridge, "duplicate", "replacement-token"),
			);
			expect(current.status).toBe(200);

			yield* Scope.close(replacement, Exit.void);
			const removed = yield* Effect.tryPromise(() =>
				requestBridge(bridge, "duplicate", "replacement-token"),
			);
			expect(removed.status).toBe(404);
		}).pipe(Effect.withSpan("runtime-replacement-test"), Effect.provide(BridgeService.layer)),
	);

	it.effect(
		"releases permits on every exit and ends queued calls when the owning scope closes",
		() =>
			Effect.gen(function* () {
				const bridge = yield* BridgeService;
				const scope = yield* Scope.make();
				const started = yield* Queue.unbounded<void>();
				const release = yield* Deferred.make<void>();
				yield* addSession(bridge, "removed", () =>
					Queue.offer(started, undefined).pipe(
						Effect.andThen(Deferred.await(release)),
						Effect.as(hostSuccess(null)),
					),
				).pipe(Effect.provideService(Scope.Scope, scope));

				const calls = yield* Effect.forEach(
					Array.from({ length: SANDBOX_LIMITS.bridge.concurrentHostCalls + 1 }),
					() => Effect.forkChild(call(bridge, "removed")),
				);
				yield* Effect.replicateEffect(
					Queue.take(started),
					SANDBOX_LIMITS.bridge.concurrentHostCalls,
				);
				yield* Scope.close(scope, Exit.void);
				const responses = yield* Effect.forEach(calls, Fiber.join);

				expect(responses.filter(({ status }) => status === 410).length).toBeGreaterThanOrEqual(
					SANDBOX_LIMITS.bridge.concurrentHostCalls,
				);
				expect(responses.every(({ status }) => status === 404 || status === 410)).toBe(true);
				expect(yield* Queue.size(started)).toBe(0);
			}).pipe(Effect.withSpan("runtime-removal-test"), Effect.provide(BridgeService.layer)),
	);

	it.effect("removes the session when the registering fiber is interrupted", () =>
		Effect.gen(function* () {
			const bridge = yield* BridgeService;
			const registered = yield* Deferred.make<void>();
			const fiber = yield* Effect.forkChild(
				Effect.scoped(
					addSession(bridge, "interrupted", () => Effect.succeed(hostSuccess(null))).pipe(
						Effect.andThen(Deferred.succeed(registered, undefined)),
						Effect.andThen(Effect.never),
					),
				),
			);
			yield* Deferred.await(registered);
			expect((yield* call(bridge, "interrupted")).status).toBe(200);

			yield* Fiber.interrupt(fiber);
			expect((yield* call(bridge, "interrupted")).status).toBe(404);
		}).pipe(Effect.withSpan("runtime-interrupt-test"), Effect.provide(BridgeService.layer)),
	);

	it.effect("checks in-memory session expiry and authorization", () =>
		Effect.gen(function* () {
			const bridge = yield* BridgeService;
			yield* addSession(bridge, "active", () => Effect.succeed(hostSuccess(null)));
			yield* addSession(bridge, "expired", () => Effect.succeed(hostSuccess(null)), {
				expiresAt: -1,
			});

			const missing = yield* call(bridge, "missing");
			expect(missing.status).toBe(404);

			const unauthorized = yield* Effect.tryPromise(() =>
				requestBridge(bridge, "active", "wrong-token"),
			);
			expect(unauthorized.status).toBe(401);

			const expired = yield* call(bridge, "expired");
			expect(expired.status).toBe(410);
		}).pipe(
			Effect.scoped,
			Effect.withSpan("runtime-session-test"),
			Effect.provide(BridgeService.layer),
		),
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
