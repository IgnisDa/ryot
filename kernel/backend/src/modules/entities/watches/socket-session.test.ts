import { assert, describe, expect, layer } from "@effect/vitest";
import { EntityWatchTicketFailure } from "@ryot-app/contract/modules/entity-watches/contract";
import {
	decodeEntityWatchServerMessage,
	encodeEntityWatchClientMessage,
} from "@ryot-app/contract/modules/entity-watches/messages";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, Deferred, Effect, Fiber, Layer, Option, Queue, Ref, Result } from "effect";
import * as Socket from "effect/socket/Socket";
import { TestClock } from "effect/testing";

import { ImpersonationSessions } from "#modules/accounts/auth/impersonation-sessions";
import { testRedisServiceLayer } from "#testing/redis";

import { LocalInterestSessions } from "./connections";
import { InterestService } from "./service";
import { runEntityWatchSocketSession } from "./socket-session";
import { EntityWatchStore } from "./store";
import { EntityWatchInvalidTicket, EntityWatchTicketService } from "./ticket-service";

const makeSocket = Effect.fn(function* (
	readyWriteGate?: Deferred.Deferred<void>,
	failReadyWrite = false,
	autoPong = false,
) {
	const opened = yield* Deferred.make<void>();
	const inbound = yield* Queue.unbounded<string | Uint8Array | null>();
	const writes = yield* Queue.unbounded<string | Socket.CloseEvent>();
	let gateReady = readyWriteGate !== undefined;
	let shouldFailReadyWrite = failReadyWrite;
	const write = (frame: string | Uint8Array | Socket.CloseEvent) =>
		Effect.gen(function* () {
			if (frame instanceof Uint8Array) {
				return yield* Effect.die("unexpected binary server frame");
			}
			yield* Queue.offer(writes, frame);
			if (typeof frame === "string" && autoPong) {
				const decoded = decodeEntityWatchServerMessage(frame);
				if (Result.isSuccess(decoded) && decoded.success.type === "ping") {
					yield* Queue.offer(
						inbound,
						encodeEntityWatchClientMessage({ type: "pong", nonce: decoded.success.nonce }),
					);
				}
			}
			if (typeof frame === "string" && shouldFailReadyWrite) {
				shouldFailReadyWrite = false;
				return yield* Effect.die("writer failed before ready acknowledgement");
			}
			if (typeof frame === "string" && gateReady && readyWriteGate !== undefined) {
				gateReady = false;
				yield* Deferred.await(readyWriteGate);
			}
			return undefined;
		});
	const socket = Socket.make({
		writer: Effect.succeed({
			write,
			writeAll: (chunks) => Effect.forEach(chunks, write, { discard: true }),
		}),
		reader: Effect.gen(function* () {
			yield* Deferred.succeed(opened, undefined);
			return {
				upgrade: Socket.SocketUpgradeError.unsupported,
				pull: Effect.gen(function* () {
					const frame = yield* Queue.take(inbound);
					return frame === null
						? yield* new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) })
						: ([frame] as const);
				}),
			};
		}),
	});
	const nextMessage = Effect.fn(function* () {
		const frame = yield* Queue.take(writes);
		if (typeof frame !== "string") {
			return yield* Effect.die("socket closed before message");
		}
		const decoded = decodeEntityWatchServerMessage(frame);
		return Result.isSuccess(decoded)
			? decoded.success
			: yield* Effect.die("server emitted an invalid message");
	});

	return {
		opened,
		writes,
		socket,
		nextMessage,
		remoteClose: Queue.offer(inbound, null).pipe(Effect.asVoid),
		send: (frame: string) => Queue.offer(inbound, frame).pipe(Effect.asVoid),
	};
});

class FakeSessionDependencies extends Context.Service<
	FakeSessionDependencies,
	{
		readonly activity: Effect.Effect<ReadonlyArray<string>>;
		readonly replacements: Effect.Effect<number>;
		readonly replaceStarted: Effect.Effect<void>;
	}
>()("test/FakeSessionDependencies") {}

/** Reconciliation never finishes; `holdReplace` keeps every replacement waiting after it starts. */
const makeLayer = (
	options: {
		readonly activeImpersonation?: "active" | "missing";
		readonly impersonationExpiresInMs?: number;
		readonly holdReplace?: boolean;
		readonly replaceOutcome?: "applied" | "limit-exceeded" | "revision-mismatch";
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const impersonationExpiresAt = yield* Ref.make<number | null>(null);
			const activity = yield* Ref.make<ReadonlyArray<string>>([]);
			const replacements = yield* Ref.make(0);
			const reconciliationGate = yield* Deferred.make<void>();
			const replaceGate = yield* Deferred.make<void>();
			const replaceStarted = yield* Deferred.make<void>();
			const record = (entry: string) => Ref.update(activity, (all) => [...all, entry]);
			return Layer.mergeAll(
				Layer.mock(EntityWatchTicketService)({
					consume: () =>
						Effect.gen(function* () {
							const principal = {
								preferredLanguage: "es",
								userId: UserId.make("user-1"),
								accountGeneration: {
									userId: UserId.make("user-1"),
									token: "test-account-generation",
								},
							};
							if (options.impersonationExpiresInMs === undefined) {
								return principal;
							}
							const expiresAt = (yield* Clock.currentTimeMillis) + options.impersonationExpiresInMs;
							yield* Ref.set(impersonationExpiresAt, expiresAt);
							return { ...principal, impersonation: { expiresAt, sessionId: "auth-session-1" } };
						}),
				}),
				Layer.mock(ImpersonationSessions)({
					getActive: (sessionId, userId) =>
						record(`auth-session-check:${sessionId}:${userId}`).pipe(
							Effect.andThen(Ref.get(impersonationExpiresAt)),
							Effect.map((expiresAt) =>
								options.activeImpersonation === "missing" || expiresAt === null
									? null
									: { expiresAt },
							),
						),
				}),
				Layer.mock(EntityWatchStore)({
					renewSession: () => Effect.succeed(true),
					closeSession: (sessionId) => record(`close:${sessionId}`).pipe(Effect.as(true)),
					openSession: ({ sessionId }) => record(`open:${sessionId}`).pipe(Effect.as(undefined)),
					markReconciled: ({ pending }) => Effect.succeed(pending.map(({ entityId }) => entityId)),
					replaceInterest: ({ revision }) =>
						Effect.gen(function* () {
							yield* Ref.update(replacements, (count) => count + 1);
							yield* Deferred.succeed(replaceStarted, undefined);
							if (options.holdReplace) {
								yield* Deferred.await(replaceGate);
							}
							if (options.replaceOutcome === "limit-exceeded") {
								return { status: "limit-exceeded" as const };
							}
							if (options.replaceOutcome === "revision-mismatch") {
								return { status: "revision-mismatch" as const };
							}
							return {
								revision,
								status: "applied" as const,
								pending: [{ revision, entityId: "entity-1", priority: "visible" as const }],
							};
						}),
				}),
				Layer.mock(InterestService)({
					reconcile: () => Deferred.await(reconciliationGate).pipe(Effect.as([])),
				}),
				Layer.mock(LocalInterestSessions)({
					remove: (sessionId) => record(`remove:${sessionId}`),
					add: (sessionId, _enqueue, revocation) =>
						record(
							revocation === undefined
								? `add:${sessionId}`
								: `add:${sessionId}:auth:${revocation.authSessionId}`,
						),
				}),
				Layer.succeed(FakeSessionDependencies, {
					activity: Ref.get(activity),
					replacements: Ref.get(replacements),
					replaceStarted: Deferred.await(replaceStarted),
				}),
			);
		}),
	);

class MarkAttempts extends Context.Service<
	MarkAttempts,
	{ readonly attempted: Effect.Effect<void> }
>()("test/MarkAttempts") {}

const obsoleteTokenLayer = Layer.unwrap(
	Effect.gen(function* () {
		const markAttempted = yield* Deferred.make<void>();
		return Layer.mergeAll(
			Layer.mock(EntityWatchTicketService)({
				consume: () =>
					Effect.succeed({
						preferredLanguage: null,
						userId: UserId.make("user-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					}),
			}),
			Layer.mock(ImpersonationSessions)({ getActive: () => Effect.succeed(null) }),
			Layer.mock(EntityWatchStore)({
				closeSession: () => Effect.succeed(true),
				renewSession: () => Effect.succeed(true),
				openSession: () => Effect.void.pipe(Effect.as(undefined)),
				markReconciled: () => Deferred.succeed(markAttempted, undefined).pipe(Effect.as([])),
				replaceInterest: () =>
					Effect.succeed({
						revision: 1,
						status: "applied" as const,
						pending: [{ revision: 1, entityId: "entity-1", priority: "visible" as const }],
					}),
			}),
			Layer.mock(InterestService)({
				reconcile: () =>
					Effect.succeed([
						{
							pending: { revision: 1, entityId: "entity-1", priority: "visible" as const },
							message: {
								reason: "populated" as const,
								type: "entity-updated" as const,
								entityId: EntityId.make("entity-1"),
							},
						},
					]),
			}),
			Layer.mock(LocalInterestSessions)({ add: () => Effect.void, remove: () => Effect.void }),
			Layer.succeed(MarkAttempts, { attempted: Deferred.await(markAttempted) }),
		);
	}),
);

describe("entity interest socket session", () => {
	layer(EntityWatchStore.layer.pipe(Layer.provide(testRedisServiceLayer)), {
		excludeTestServices: true,
	})((test) => {
		test.effect(
			"drops real Redis output from removed and re-added interest before delivering its new token",
			() =>
				Effect.scoped(
					Effect.gen(function* () {
						const store = yield* EntityWatchStore;
						const firstStarted = yield* Deferred.make<void>();
						const releaseFirst = yield* Deferred.make<void>();
						const staleMarked = yield* Deferred.make<readonly string[]>();
						const releaseLatest = yield* Deferred.make<void>();
						const entityId = EntityId.make(`replacement-${crypto.randomUUID()}`);
						const dependencies = Layer.mergeAll(
							Layer.mock(EntityWatchTicketService)({
								consume: () =>
									Effect.succeed({
										preferredLanguage: null,
										userId: UserId.make("user-1"),
										accountGeneration: {
											userId: UserId.make("user-1"),
											token: "test-account-generation",
										},
									}),
							}),
							Layer.mock(ImpersonationSessions)({ getActive: () => Effect.succeed(null) }),
							Layer.mock(LocalInterestSessions)({
								add: () => Effect.void,
								remove: () => Effect.void,
							}),
							Layer.succeed(EntityWatchStore, {
								...store,
								markReconciled: (input) =>
									store
										.markReconciled(input)
										.pipe(
											Effect.tap((marked) =>
												input.pending[0]?.revision === 1
													? Deferred.succeed(staleMarked, marked)
													: Effect.void,
											),
										),
							}),
							Layer.mock(InterestService)({
								reconcile: ({ pending }) =>
									Effect.gen(function* () {
										if (pending[0]?.revision === 1) {
											yield* Deferred.succeed(firstStarted, undefined);
											yield* Deferred.await(releaseFirst);
										} else {
											yield* Deferred.await(releaseLatest);
										}
										return pending.map((item) => ({
											pending: item,
											message: {
												entityId,
												type: "entity-updated" as const,
												reason:
													item.revision === 1 ? ("translated" as const) : ("populated" as const),
											},
										}));
									}),
							}),
						);
						const socket = yield* makeSocket();
						const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(
							Effect.provideContext(yield* Layer.build(dependencies)),
							Effect.forkChild,
						);
						yield* Deferred.await(socket.opened);
						yield* socket.send(
							encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
						);
						const ready = yield* socket.nextMessage();
						assert(ready.type === "ready");
						for (const revision of [1, 2, 3]) {
							yield* socket.send(
								encodeEntityWatchClientMessage({
									revision,
									type: "replace",
									entityIds: revision === 2 ? [] : [entityId],
									foregroundIds: revision === 2 ? [] : [entityId],
								}),
							);
							expect(yield* socket.nextMessage()).toEqual({ revision, type: "applied" });
							if (revision === 1) {
								yield* Deferred.await(firstStarted);
							}
						}
						yield* Deferred.succeed(releaseFirst, undefined);
						expect(yield* Deferred.await(staleMarked)).toEqual([]);
						expect(yield* Queue.poll(socket.writes)).toEqual(Option.none());
						yield* Deferred.succeed(releaseLatest, undefined);
						expect(yield* socket.nextMessage()).toEqual({
							entityId,
							reason: "populated",
							type: "entity-updated",
						});
						expect(yield* store.listWatchingSessions(entityId)).toContain(ready.sessionId);
						yield* socket.remoteClose;
						yield* Fiber.await(fiber);
						expect(yield* store.listInterestedSessions(entityId)).not.toContain(ready.sessionId);
					}),
				),
		);
	});

	layer(makeLayer())((test) => {
		test.effect(
			"authenticates, acknowledges commands while reconciliation is blocked, and cleans up",
			() =>
				Effect.scoped(
					Effect.gen(function* () {
						const fake = yield* FakeSessionDependencies;
						const socket = yield* makeSocket();
						const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
						yield* Deferred.await(socket.opened);
						yield* socket.send(
							encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
						);
						const ready = yield* socket.nextMessage();
						if (ready.type !== "ready") {
							return yield* Effect.die("expected ready message");
						}

						yield* socket.send(
							encodeEntityWatchClientMessage({
								revision: 1,
								type: "replace",
								foregroundIds: [],
								entityIds: ["entity-1"],
							}),
						);
						expect(yield* socket.nextMessage()).toEqual({ revision: 1, type: "applied" });
						yield* socket.send(
							encodeEntityWatchClientMessage({
								revision: 2,
								type: "replace",
								foregroundIds: [],
								entityIds: ["entity-1", "entity-2"],
							}),
						);
						expect(yield* socket.nextMessage()).toEqual({ revision: 2, type: "applied" });

						yield* socket.remoteClose;
						yield* Fiber.await(fiber);
						const sessionId = ready.sessionId;
						expect(yield* fake.activity).toEqual([
							`open:${sessionId}`,
							`add:${sessionId}`,
							`remove:${sessionId}`,
							`close:${sessionId}`,
						]);
						return undefined;
					}),
				),
		);
	});

	layer(makeLayer({ activeImpersonation: "missing", impersonationExpiresInMs: 60_000 }))((test) => {
		test.effect("rechecks an impersonation session after local registration", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const fake = yield* FakeSessionDependencies;
					const socket = yield* makeSocket();
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);

					const close = yield* Queue.take(socket.writes);
					assert(Socket.isCloseEvent(close));
					expect(close.code).toBe(4001);
					expect(close.reason).toBe("Session expired");
					yield* Fiber.await(fiber);
					expect(yield* fake.activity).toEqual([
						expect.stringMatching(/^open:/),
						expect.stringMatching(/^add:.*:auth:auth-session-1$/),
						"auth-session-check:auth-session-1:user-1",
						expect.stringMatching(/^remove:/),
						expect.stringMatching(/^close:/),
					]);
				}),
			),
		);
	});

	layer(
		Layer.mergeAll(
			Layer.mock(EntityWatchTicketService)({
				consume: () => Effect.fail(new EntityWatchInvalidTicket()),
			}),
			Layer.mock(ImpersonationSessions)({ getActive: () => Effect.succeed(null) }),
			Layer.mock(EntityWatchStore)({}),
			Layer.mock(InterestService)({}),
			Layer.mock(LocalInterestSessions)({}),
		),
	)((test) => {
		test.effect("uses the generic policy close for an invalid ticket", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const socket = yield* makeSocket();
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "invalid", type: "authenticate" }),
					);
					const close = yield* Queue.take(socket.writes);
					if (!Socket.isCloseEvent(close)) {
						return yield* Effect.die("expected close event");
					}
					expect(close.code).toBe(1008);
					expect(close.reason).toBe("Authentication failed");
					yield* Fiber.await(fiber);
					return undefined;
				}),
			),
		);
	});

	layer(
		Layer.mergeAll(
			Layer.mock(EntityWatchTicketService)({
				consume: () =>
					Effect.fail(
						new EntityWatchTicketFailure({ reason: { code: "ticket-store-unavailable" } }),
					),
			}),
			Layer.mock(ImpersonationSessions)({ getActive: () => Effect.succeed(null) }),
			Layer.mock(EntityWatchStore)({}),
			Layer.mock(InterestService)({}),
			Layer.mock(LocalInterestSessions)({}),
		),
	)((test) => {
		test.effect("uses the internal-error close when the ticket store is unavailable", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const socket = yield* makeSocket();
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					const close = yield* Queue.take(socket.writes);
					expect(Socket.isCloseEvent(close) && close.code).toBe(1011);
					expect(Socket.isCloseEvent(close) && close.reason).toBe("Internal error");
					yield* Fiber.await(fiber);
				}),
			),
		);
	});

	layer(makeLayer())((test) => {
		test.effect("does not process pipelined commands until ready has been written", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const fake = yield* FakeSessionDependencies;
					const readyWriteGate = yield* Deferred.make<void>();
					const socket = yield* makeSocket(readyWriteGate);
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					yield* socket.send(
						encodeEntityWatchClientMessage({
							revision: 1,
							type: "replace",
							foregroundIds: [],
							entityIds: ["entity-1"],
						}),
					);

					expect((yield* socket.nextMessage()).type).toBe("ready");
					yield* Effect.yieldNow;
					expect(yield* fake.replacements).toBe(0);
					yield* Deferred.succeed(readyWriteGate, undefined);
					expect(yield* socket.nextMessage()).toEqual({ revision: 1, type: "applied" });
					yield* socket.remoteClose;
					yield* Fiber.await(fiber);
				}),
			),
		);
	});

	layer(makeLayer())((test) => {
		test.effect("cleans up when the writer fails before acknowledging ready", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const fake = yield* FakeSessionDependencies;
					const socket = yield* makeSocket(undefined, true);
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					const ready = yield* socket.nextMessage();
					if (ready.type !== "ready") {
						return yield* Effect.die("expected ready message");
					}

					yield* Fiber.await(fiber);
					expect(yield* fake.activity).toEqual([
						`open:${ready.sessionId}`,
						`add:${ready.sessionId}`,
						`remove:${ready.sessionId}`,
						`close:${ready.sessionId}`,
					]);
					return undefined;
				}),
			),
		);
	});

	layer(makeLayer())((test) => {
		test.effect("stops processing buffered commands after a protocol error", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const fake = yield* FakeSessionDependencies;
					const socket = yield* makeSocket();
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					expect((yield* socket.nextMessage()).type).toBe("ready");
					yield* socket.send(
						'{"type":"update","revision":1,"add":["invalid"],"remove":[],"addForeground":[],"removeForeground":[]}',
					);
					yield* socket.send(
						encodeEntityWatchClientMessage({
							revision: 1,
							entityIds: [],
							type: "replace",
							foregroundIds: [],
						}),
					);

					const close = yield* Queue.take(socket.writes);
					expect(Socket.isCloseEvent(close) && close.code).toBe(1002);
					yield* Fiber.await(fiber);
					expect(yield* fake.replacements).toBe(0);
				}),
			),
		);
	});

	layer(makeLayer({ replaceOutcome: "revision-mismatch" }))((test) => {
		test.effect("closes on revision mismatch without processing another buffered command", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const fake = yield* FakeSessionDependencies;
					const socket = yield* makeSocket();
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					expect((yield* socket.nextMessage()).type).toBe("ready");
					yield* socket.send(
						encodeEntityWatchClientMessage({
							revision: 1,
							entityIds: [],
							type: "replace",
							foregroundIds: [],
						}),
					);
					yield* socket.send(
						encodeEntityWatchClientMessage({
							revision: 1,
							entityIds: [],
							type: "replace",
							foregroundIds: [],
						}),
					);

					const close = yield* Queue.take(socket.writes);
					expect(Socket.isCloseEvent(close) && close.code).toBe(1002);
					yield* Fiber.await(fiber);
					expect(yield* fake.replacements).toBe(1);
				}),
			),
		);
	});

	layer(makeLayer({ replaceOutcome: "limit-exceeded" }))((test) => {
		test.effect("rejects over-limit commands without closing the session", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const socket = yield* makeSocket();
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					expect((yield* socket.nextMessage()).type).toBe("ready");
					yield* socket.send(
						encodeEntityWatchClientMessage({
							revision: 1,
							entityIds: [],
							type: "replace",
							foregroundIds: [],
						}),
					);

					expect(yield* socket.nextMessage()).toEqual({
						revision: 1,
						type: "rejected",
						maxEntityIds: 500,
						code: "interest-limit-exceeded",
					});
					yield* socket.remoteClose;
					yield* Fiber.await(fiber);
				}),
			),
		);
	});

	layer(obsoleteTokenLayer)((test) => {
		test.effect("drops terminal reconciliation from an obsolete pending token", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const activity: string[] = [];
					const socket = yield* makeSocket();
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					expect((yield* socket.nextMessage()).type).toBe("ready");
					yield* socket.send(
						encodeEntityWatchClientMessage({
							revision: 1,
							type: "replace",
							foregroundIds: [],
							entityIds: ["entity-1"],
						}),
					);
					expect(yield* socket.nextMessage()).toEqual({ revision: 1, type: "applied" });
					yield* (yield* MarkAttempts).attempted;
					expect(yield* Queue.poll(socket.writes)).toEqual(Option.none());
					yield* socket.remoteClose;
					yield* Fiber.await(fiber);
					expect(activity).toEqual([]);
				}),
			),
		);
	});

	layer(makeLayer())((test) => {
		test.effect("closes when a heartbeat pong does not arrive", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const socket = yield* makeSocket();
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					expect((yield* socket.nextMessage()).type).toBe("ready");
					yield* TestClock.adjust("25 seconds");
					expect((yield* socket.nextMessage()).type).toBe("ping");
					yield* TestClock.adjust("10 seconds");
					const close = yield* Queue.take(socket.writes);
					expect(Socket.isCloseEvent(close) && close.code).toBe(4000);
					yield* Fiber.await(fiber);
				}),
			),
		);
	});

	layer(makeLayer())((test) => {
		test.effect("expires an authenticated session after 15 minutes and cleans up", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const fake = yield* FakeSessionDependencies;
					const socket = yield* makeSocket(undefined, false, true);
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					const ready = yield* socket.nextMessage();
					assert(ready.type === "ready");

					for (let interval = 0; interval < 35; interval += 1) {
						yield* TestClock.adjust("25 seconds");
						yield* Effect.yieldNow;
					}
					yield* TestClock.adjust("24 seconds");
					const beforeExpiry = yield* Queue.takeAll(socket.writes);
					expect(Array.from(beforeExpiry).every((frame) => !Socket.isCloseEvent(frame))).toBe(true);
					expect(yield* fake.activity).toEqual([
						`open:${ready.sessionId}`,
						`add:${ready.sessionId}`,
					]);

					yield* TestClock.adjust("1 second");
					const close = yield* Queue.take(socket.writes);
					assert(Socket.isCloseEvent(close));
					expect(close.code).toBe(4001);
					expect(close.reason).toBe("Session expired");
					yield* Fiber.await(fiber);
					expect(yield* fake.activity).toEqual([
						`open:${ready.sessionId}`,
						`add:${ready.sessionId}`,
						`remove:${ready.sessionId}`,
						`close:${ready.sessionId}`,
					]);
				}),
			),
		);
	});

	layer(makeLayer({ impersonationExpiresInMs: 5_000 }))((test) => {
		test.effect(
			"leases an impersonated socket only through the exact session expiry boundary",
			() =>
				Effect.scoped(
					Effect.gen(function* () {
						const socket = yield* makeSocket();
						const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
						yield* Deferred.await(socket.opened);
						yield* socket.send(
							encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
						);
						assert((yield* socket.nextMessage()).type === "ready");
						yield* Effect.yieldNow;

						yield* TestClock.adjust("4 seconds");
						yield* Effect.yieldNow;
						expect(yield* Queue.poll(socket.writes)).toEqual(Option.none());

						yield* TestClock.adjust("1 second");
						yield* Effect.yieldNow;
						const atExpiry = yield* Queue.poll(socket.writes);
						assert(Option.isSome(atExpiry));
						assert(Socket.isCloseEvent(atExpiry.value));
						const close = atExpiry.value;
						expect(close.code).toBe(4001);
						expect(close.reason).toBe("Session expired");
						yield* Fiber.await(fiber);
					}),
				),
		);
	});

	layer(makeLayer({ holdReplace: true }))((test) => {
		test.effect("stops buffered commands when heartbeat shutdown interrupts the processor", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const fake = yield* FakeSessionDependencies;
					const socket = yield* makeSocket();
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityWatchClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					expect((yield* socket.nextMessage()).type).toBe("ready");
					yield* socket.send(
						encodeEntityWatchClientMessage({
							revision: 1,
							entityIds: [],
							type: "replace",
							foregroundIds: [],
						}),
					);
					yield* fake.replaceStarted;
					yield* socket.send(
						encodeEntityWatchClientMessage({
							revision: 2,
							entityIds: [],
							type: "replace",
							foregroundIds: [],
						}),
					);

					yield* TestClock.adjust("25 seconds");
					expect((yield* socket.nextMessage()).type).toBe("ping");
					yield* TestClock.adjust("10 seconds");
					const close = yield* Queue.take(socket.writes);
					expect(Socket.isCloseEvent(close) && close.code).toBe(4000);
					yield* Fiber.await(fiber);
					expect(yield* fake.replacements).toBe(1);
				}),
			),
		);
	});

	layer(
		Layer.mergeAll(
			Layer.mock(EntityWatchTicketService)({}),
			Layer.mock(ImpersonationSessions)({ getActive: () => Effect.succeed(null) }),
			Layer.mock(EntityWatchStore)({}),
			Layer.mock(InterestService)({}),
			Layer.mock(LocalInterestSessions)({}),
		),
	)((test) => {
		test.effect("closes unauthenticated sockets after exactly five seconds", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const socket = yield* makeSocket();
					const fiber = yield* runEntityWatchSocketSession(socket.socket).pipe(Effect.forkChild);
					yield* Deferred.await(socket.opened);
					yield* TestClock.adjust("4999 millis");
					expect(yield* Queue.poll(socket.writes)).toEqual(Option.none());
					yield* TestClock.adjust("1 millis");
					const close = yield* Queue.take(socket.writes);
					if (!Socket.isCloseEvent(close)) {
						return yield* Effect.die("expected close event");
					}
					expect(close.code).toBe(1008);
					yield* Fiber.await(fiber);
					return undefined;
				}),
			),
		);
	});
});
