import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { captureResetLink, deliverResetLink, type ResetCaptureTransport } from "./reset-capture";

const email = "owner@example.test";
const frontendUrl = "https://ryot.example";

const harness = () => {
	const pending = new Map<string, string>();
	const listeners = new Set<(id: string, message: string) => void>();
	const subscriptions = new Set<string>();
	let closed = 0;
	let failSubscription = false;
	const transport: ResetCaptureTransport = {
		release: (address, id) =>
			Effect.sync(() => {
				if (pending.get(address) === id) {
					pending.delete(address);
				}
			}),
		reserve: (address, id) =>
			Effect.sync(() => {
				if (pending.has(address)) {
					return false;
				}
				pending.set(address, id);
				return true;
			}),
		deliver: (address, id, message) =>
			Effect.sync(() => {
				if (pending.get(address) !== id) {
					return;
				}
				for (const listener of listeners) {
					listener(id, message);
				}
				pending.delete(address);
			}),
		subscriber: () => ({
			quit: () =>
				Effect.sync(() => {
					closed += 1;
				}),
			onMessage: (listener) => {
				listeners.add(listener);
			},
			offMessage: (listener) => {
				listeners.delete(listener);
			},
			unsubscribe: (id) =>
				Effect.sync(() => {
					subscriptions.delete(id);
				}),
			subscribe: (id) =>
				failSubscription
					? Effect.fail(new DbError({ message: "subscription failed" }))
					: Effect.sync(() => {
							subscriptions.add(id);
						}),
		}),
	};
	return {
		pending,
		transport,
		listeners,
		subscriptions,
		closed: () => closed,
		failSubscription: () => {
			failSubscription = true;
		},
	};
};

const capture = (
	transport: ResetCaptureTransport,
	initiate: (request: Request) => Promise<Response>,
	address = email,
) => captureResetLink({ initiate, transport, frontendUrl, email: address, timeoutMs: 1_000 });

it.effect("subscribes before initiation and releases resources after capture", () =>
	Effect.gen(function* () {
		const state = harness();
		const runtime = yield* Effect.context();
		const result = yield* capture(state.transport, (request) => {
			expect(state.subscriptions.size).toBe(1);
			return Effect.runPromiseWith(runtime)(
				deliverResetLink({
					email,
					request,
					frontendUrl,
					token: "token",
					transport: state.transport,
				}).pipe(Effect.as(new Response(null, { status: 200 }))),
			);
		});
		expect(result.resetUrl).toBe(`${frontendUrl}/reset-password?token=token`);
		expect(state.pending.size).toBe(0);
		expect(state.listeners.size).toBe(0);
		expect(state.subscriptions.size).toBe(0);
		expect(state.closed()).toBe(1);
	}),
);

it.effect("reports subscription and initiation failures separately", () =>
	Effect.gen(function* () {
		const failedSubscribe = harness();
		failedSubscribe.failSubscription();
		let initiated = false;
		const subscribeError = yield* Effect.flip(
			capture(failedSubscribe.transport, () => {
				initiated = true;
				return Promise.resolve(new Response(null));
			}),
		);
		expect(subscribeError.message).toContain("subscription");
		expect(initiated).toBe(false);
		expect(failedSubscribe.pending.size).toBe(0);
		expect(failedSubscribe.listeners.size).toBe(0);
		expect(failedSubscribe.closed()).toBe(1);

		const failedInitiate = harness();
		const error = yield* Effect.flip(
			capture(failedInitiate.transport, () => Promise.reject(new Error("no reset"))),
		);
		expect(error.message).toContain("initiation");
		expect(failedInitiate.pending.size).toBe(0);
		expect(failedInitiate.listeners.size).toBe(0);
		expect(failedInitiate.closed()).toBe(1);
	}),
);

it.effect("times out an old request without sending its late token into a newer reservation", () =>
	Effect.gen(function* () {
		const state = harness();
		const runtime = yield* Effect.context();
		const started = yield* Deferred.make<Request>();
		const finish = yield* Deferred.make<void>();
		const first = yield* capture(state.transport, (request) => {
			Effect.runSyncWith(runtime)(Deferred.succeed(started, request));
			return Effect.runPromiseWith(runtime)(
				Deferred.await(finish).pipe(
					Effect.andThen(
						deliverResetLink({
							email,
							request,
							frontendUrl,
							token: "old",
							transport: state.transport,
						}),
					),
					Effect.as(new Response(null)),
				),
			);
		}).pipe(Effect.forkChild);
		const oldRequest = yield* Deferred.await(started);
		const conflict = yield* Effect.flip(
			capture(state.transport, () => Promise.resolve(new Response(null))),
		);
		expect(conflict.message).toContain("already");
		yield* TestClock.adjust("1 second");
		expect(Exit.isFailure(yield* Fiber.await(first))).toBe(true);
		const second = yield* capture(state.transport, (request) =>
			Effect.runPromiseWith(runtime)(
				deliverResetLink({
					email,
					frontendUrl,
					token: "old",
					request: oldRequest,
					transport: state.transport,
				}).pipe(
					Effect.tap(() =>
						Effect.sync(() => {
							expect(state.pending.size).toBe(1);
						}),
					),
					Effect.andThen(
						deliverResetLink({
							email,
							request,
							frontendUrl,
							token: "new",
							transport: state.transport,
						}),
					),
					Effect.as(new Response(null)),
				),
			),
		).pipe(Effect.forkChild);
		yield* Deferred.succeed(finish, undefined);
		expect((yield* Fiber.join(second)).resetUrl).toContain("new");
		expect(state.pending.size).toBe(0);
		expect(state.closed()).toBe(2);
	}),
);

it.effect("interrupts a pending capture and allows a different email concurrently", () =>
	Effect.gen(function* () {
		const state = harness();
		const runtime = yield* Effect.context();
		const started = yield* Deferred.make<void>();
		const finish = yield* Deferred.make<void>();
		const fiber = yield* capture(state.transport, () => {
			Effect.runSyncWith(runtime)(Deferred.succeed(started, undefined));
			return Effect.runPromiseWith(runtime)(
				Deferred.await(finish).pipe(Effect.as(new Response(null))),
			);
		}).pipe(Effect.forkChild);
		yield* Deferred.await(started);
		const other = yield* capture(
			state.transport,
			(request) =>
				Effect.runPromiseWith(runtime)(
					deliverResetLink({
						request,
						frontendUrl,
						token: "other",
						transport: state.transport,
						email: "other@example.test",
					}).pipe(Effect.as(new Response(null))),
				),
			"other@example.test",
		);
		expect(other.resetUrl).toContain("other");
		expect(state.pending.size).toBe(1);
		yield* Fiber.interrupt(fiber);
		yield* Deferred.succeed(finish, undefined);
		expect(state.pending.size).toBe(0);
		expect(state.listeners.size).toBe(0);
		expect(state.subscriptions.size).toBe(0);
		expect(state.closed()).toBe(2);
	}),
);

it.effect(
	"does not release a reservation replaced by another owner or trust an external header",
	() =>
		Effect.gen(function* () {
			const state = harness();
			const runtime = yield* Effect.context();
			const started = yield* Deferred.make<void>();
			const captureFiber = yield* capture(state.transport, () => {
				state.pending.set(email, "replacement-id");
				Effect.runSyncWith(runtime)(Deferred.succeed(started, undefined));
				return Effect.runPromiseWith(runtime)(Effect.never);
			}).pipe(Effect.forkChild);
			yield* Deferred.await(started);
			yield* deliverResetLink({
				email,
				frontendUrl,
				token: "external",
				transport: state.transport,
				request: new Request(frontendUrl, {
					headers: { "x-ryot-reset-capture-id": "unreserved-id" },
				}),
			});
			expect(state.pending.get(email)).toBe("replacement-id");
			yield* Fiber.interrupt(captureFiber);
			expect(state.pending.get(email)).toBe("replacement-id");
			expect(state.listeners.size).toBe(0);
			expect(state.subscriptions.size).toBe(0);
			expect(state.closed()).toBe(1);
		}),
);
