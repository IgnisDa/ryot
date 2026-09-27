import { it, layer } from "@effect/vitest";
import { hostFailure, hostSuccess, type SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import type { Schema } from "effect";
import {
	Clock,
	Context,
	Deferred,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	Queue,
	Ref,
	Scope,
	Semaphore,
	Tracer,
} from "effect";
import { describe, expect } from "vitest";

import { makeRecordingTracer } from "#lib/test-utils/tracer";

import { SANDBOX_LIMITS } from "./limits";
import { BridgeService, withSandboxHostCallPermit } from "./runtime";
import { makeWorkflowReplayJournalHostFunction } from "./workflow-journal";

const bootstrapEntryValue = {
	value: null,
	request: { index: 0, name: "pause", kind: "sleep" as const, args: { durationMs: 1 } },
};

const addSession = Effect.fnUntraced(function* (
	bridge: BridgeService["Service"],
	executionId: string,
	host: () => Effect.Effect<unknown, Schema.SchemaError | SandboxHostError>,
	options: { readonly token?: string; readonly expiresAt?: number } = {},
) {
	const parentSpan = yield* Effect.currentSpan;
	const now = yield* Clock.currentTimeMillis;
	yield* bridge.addSession(executionId, {
		parentSpan,
		apiFunctions: { test: () => host() },
		expiresAt: options.expiresAt ?? now + 60_000,
		hostCallLimit: SANDBOX_LIMITS.hostCalls.total,
		token: options.token ?? `${executionId}-token`,
	});
});

const requestBridge = (
	bridge: BridgeService["Service"],
	executionId: string,
	token = `${executionId}-token`,
	functionName = "test",
) =>
	fetch(`http://127.0.0.1:${bridge.port}/rpc/${executionId}/${functionName}`, {
		method: "POST",
		body: '{"args":[]}',
		headers: { authorization: `Bearer ${token}` },
	});

const call = (bridge: BridgeService["Service"], executionId: string) =>
	Effect.tryPromise(() => requestBridge(bridge, executionId));

class RecordedSpans extends Context.Service<
	RecordedSpans,
	{ readonly spans: Effect.Effect<ReadonlyArray<Tracer.Span>> }
>()("test/RecordedSpans") {}

const tracedBridgeLayer = Layer.unwrap(
	Effect.sync(() => {
		const spans: Tracer.Span[] = [];
		return BridgeService.layer.pipe(
			Layer.provideMerge(Layer.succeed(Tracer.Tracer, makeRecordingTracer(spans))),
			Layer.merge(Layer.succeed(RecordedSpans, { spans: Effect.sync(() => [...spans]) })),
		);
	}),
);

describe("sandbox bridge host-call concurrency", () => {
	layer(BridgeService.layer)((test) => {
		test.effect("transports boundary reason data in a normal bridge result", () =>
			Effect.gen(function* () {
				const bridge = yield* BridgeService;
				const reason = { keys: ["apiToken"], code: "missing-required-config" } as const;
				yield* addSession(bridge, "boundary-reason", () =>
					Effect.succeed(hostFailure("A required configuration value is not configured", reason)),
				);

				const response = yield* call(bridge, "boundary-reason");
				expect(yield* Effect.tryPromise(() => response.json())).toMatchObject({
					result: {
						data: reason,
						success: false,
						error: expect.stringContaining("not configured"),
					},
				});
			}).pipe(Effect.scoped, Effect.withSpan("sandbox-boundary-reason-test")),
		);
	});

	layer(BridgeService.layer)((test) => {
		test.effect("returns a structured reason when the server HTTP-call budget is exceeded", () =>
			Effect.gen(function* () {
				const bridge = yield* BridgeService;
				const executionId = "http-budget";
				yield* bridge.addSession(executionId, {
					token: `${executionId}-token`,
					parentSpan: yield* Effect.currentSpan,
					hostCallLimit: SANDBOX_LIMITS.hostCalls.total,
					expiresAt: (yield* Clock.currentTimeMillis) + 60_000,
					apiFunctions: { httpCall: () => Effect.succeed(hostSuccess(null)) },
				});
				for (let index = 0; index < SANDBOX_LIMITS.hostCalls.http; index += 1) {
					yield* Effect.tryPromise(() => requestBridge(bridge, executionId, undefined, "httpCall"));
				}

				const rejected = yield* Effect.tryPromise(() =>
					requestBridge(bridge, executionId, undefined, "httpCall"),
				);
				expect(yield* Effect.tryPromise(() => rejected.json())).toMatchObject({
					result: {
						success: false,
						data: { operation: "httpCall", code: "execution-limit" },
						error: expect.stringContaining(`${SANDBOX_LIMITS.hostCalls.http} httpCall calls`),
					},
				});
			}).pipe(Effect.scoped, Effect.withSpan("sandbox-http-limit-test")),
		);
	});

	layer(BridgeService.layer)((test) => {
		test.effect("rejects stdin bootstrap arguments and consumes the failed attempt", () =>
			Effect.gen(function* () {
				const bridge = yield* BridgeService;
				const replayJournal = makeWorkflowReplayJournalHostFunction([bootstrapEntryValue]);
				yield* bridge.addSession("bootstrap-arguments", {
					token: "unused",
					hostCallLimit: 2,
					apiFunctions: { replayJournal },
					parentSpan: yield* Effect.currentSpan,
					expiresAt: (yield* Clock.currentTimeMillis) + 60_000,
				});
				const rejected = yield* bridge.bootstrap(
					"bootstrap-arguments",
					"unused",
					'{"args":["unexpected"]}',
				);
				expect(yield* Effect.tryPromise(() => rejected.json())).toEqual({
					result: { success: false, error: "replayJournal does not accept arguments" },
				});
				const accepted = yield* bridge.bootstrap("bootstrap-arguments", "unused", '{"args":[]}');
				expect(yield* Effect.tryPromise(() => accepted.json())).toEqual({
					result: hostSuccess([bootstrapEntryValue]),
				});
				const exhausted = yield* Effect.tryPromise(() =>
					requestBridge(bridge, "bootstrap-arguments", "unused", "replayJournal"),
				);
				expect(yield* Effect.tryPromise(() => exhausted.json())).toMatchObject({
					result: {
						success: false,
						data: { code: "execution-limit" },
						error: expect.stringContaining("exceeds 2 host calls"),
					},
				});
			}).pipe(Effect.scoped, Effect.withSpan("bootstrap-argument-test")),
		);
	});

	layer(BridgeService.layer)((test) => {
		test.effect("authenticates stdin bootstrap and shares its budget with HTTP calls", () =>
			Effect.gen(function* () {
				const bridge = yield* BridgeService;
				let calls = 0;
				const host = () =>
					Effect.sync(() => {
						calls += 1;
						return hostSuccess([]);
					});
				yield* bridge.addSession("stdin-bootstrap", {
					hostCallLimit: 1,
					token: "stdin-token",
					parentSpan: yield* Effect.currentSpan,
					apiFunctions: { test: host, replayJournal: host },
					expiresAt: (yield* Clock.currentTimeMillis) + 60_000,
				});
				expect(
					(yield* bridge.bootstrap("stdin-bootstrap", "wrong-token", '{"args":[]}')).status,
				).toBe(401);
				expect(calls).toBe(0);
				const reply = yield* bridge.bootstrap("stdin-bootstrap", "stdin-token", '{"args":[]}');
				expect(yield* Effect.tryPromise(() => reply.json())).toEqual({ result: hostSuccess([]) });
				const exhausted = yield* Effect.tryPromise(() =>
					requestBridge(bridge, "stdin-bootstrap", "stdin-token"),
				);
				expect(yield* Effect.tryPromise(() => exhausted.json())).toMatchObject({
					result: {
						success: false,
						data: { code: "execution-limit" },
						error: expect.stringContaining("exceeds 1 host calls"),
					},
				});
				expect(calls).toBe(1);
			}).pipe(Effect.scoped, Effect.withSpan("stdin-bootstrap-test")),
		);
	});

	layer(tracedBridgeLayer)((test) => {
		test.effect(
			"preserves HTTP context while correlating host calls with the sandbox execution",
			() =>
				Effect.gen(function* () {
					const bridge = yield* BridgeService;
					yield* addSession(bridge, "traced", () => Effect.succeed(hostSuccess(null)));
					expect((yield* call(bridge, "traced")).status).toBe(200);

					const spans = yield* (yield* RecordedSpans).spans;
					const execution = spans.find((span) => span.name === "sandbox.execution");
					const http = spans.find((span) => span.name === "http.server POST");
					const request = spans.find((span) => span.name === "BridgeService.handleRequest");
					const host = spans.find((span) => span.name === "sandbox.host.test");
					expect(request?.parent.pipe(Option.getOrUndefined)).toBe(http);
					expect(request?.traceId).toBe(http?.traceId);
					expect(host?.parent.pipe(Option.getOrUndefined)).toBe(execution);
					expect(host?.traceId).toBe(execution?.traceId);
				}).pipe(Effect.scoped, Effect.withSpan("sandbox.execution")),
		);
	});

	layer(BridgeService.layer)((test) => {
		test.effect("bounds queued calls and isolates execution ids", () =>
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
				yield* Effect.replicateEffect(
					Queue.take(started),
					SANDBOX_LIMITS.bridge.concurrentHostCalls,
				);
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
			}).pipe(Effect.scoped, Effect.withSpan("runtime-concurrency-test")),
		);
	});

	layer(BridgeService.layer)((test) => {
		test.effect("ends a replaced session and keeps the newer registration installed", () =>
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
			}).pipe(Effect.withSpan("runtime-replacement-test")),
		);
	});

	layer(BridgeService.layer)((test) => {
		test.effect(
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
				}).pipe(Effect.withSpan("runtime-removal-test")),
		);
	});

	layer(BridgeService.layer)((test) => {
		test.effect("removes the session when the registering fiber is interrupted", () =>
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
			}).pipe(Effect.withSpan("runtime-interrupt-test")),
		);
	});

	layer(BridgeService.layer)((test) => {
		test.effect("checks in-memory session expiry and authorization", () =>
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
			}).pipe(Effect.scoped, Effect.withSpan("runtime-session-test")),
		);
	});

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
