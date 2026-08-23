import { assert, describe, expect, it } from "@effect/vitest";
import { EntityInterestTicketFailure } from "@ryot-app/contract/modules/entity-interest/contract";
import {
	decodeEntityInterestServerMessage,
	encodeEntityInterestClientMessage,
} from "@ryot-app/contract/modules/entity-interest/messages";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Deferred, Effect, Fiber, Layer, Option, Queue, Result } from "effect";
import { TestClock } from "effect/testing";
import * as Socket from "effect/unstable/socket/Socket";

import { LocalInterestSessions } from "./connections";
import { InterestService } from "./service";
import { runEntityInterestSocketSession } from "./socket-session";
import { EntityInterestStore } from "./store";
import { EntityInterestInvalidTicket, EntityInterestTicketService } from "./ticket-service";

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
				const decoded = decodeEntityInterestServerMessage(frame);
				if (Result.isSuccess(decoded) && decoded.success.type === "ping") {
					yield* Queue.offer(
						inbound,
						encodeEntityInterestClientMessage({ type: "pong", nonce: decoded.success.nonce }),
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
		const decoded = decodeEntityInterestServerMessage(frame);
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

const makeLayer = (
	activity: string[],
	reconciliationGate: Deferred.Deferred<void>,
	options: {
		readonly onReplace?: () => void;
		readonly replaceGate?: Deferred.Deferred<void>;
		readonly replaceStarted?: Deferred.Deferred<void>;
		readonly replaceOutcome?: "applied" | "limit-exceeded" | "revision-mismatch";
	} = {},
) =>
	Layer.mergeAll(
		Layer.mock(EntityInterestTicketService)({
			consume: () => Effect.succeed({ preferredLanguage: "es", userId: UserId.make("user-1") }),
		}),
		Layer.mock(EntityInterestStore)({
			renewSession: () => Effect.succeed(true),
			markReconciled: ({ pending }) => Effect.succeed(pending.map(({ entityId }) => entityId)),
			closeSession: (sessionId) =>
				Effect.sync(() => {
					activity.push(`close:${sessionId}`);
					return true;
				}),
			openSession: ({ sessionId }) =>
				Effect.sync(() => {
					activity.push(`open:${sessionId}`);
				}).pipe(Effect.as(undefined)),
			updateInterest: ({ revision }) =>
				Effect.succeed({
					revision,
					status: "applied" as const,
					pending: [{ revision, entityId: "entity-2" }],
				}),
			replaceInterest: ({ revision }) =>
				Effect.gen(function* () {
					options.onReplace?.();
					if (options.replaceStarted !== undefined) {
						yield* Deferred.succeed(options.replaceStarted, undefined);
					}
					if (options.replaceGate !== undefined) {
						yield* Deferred.await(options.replaceGate);
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
						pending: [{ revision, entityId: "entity-1" }],
					};
				}),
		}),
		Layer.mock(InterestService)({
			reconcile: () => Deferred.await(reconciliationGate).pipe(Effect.as([])),
		}),
		Layer.mock(LocalInterestSessions)({
			add: (sessionId) =>
				Effect.sync(() => {
					activity.push(`add:${sessionId}`);
				}),
			remove: (sessionId) =>
				Effect.sync(() => {
					activity.push(`remove:${sessionId}`);
				}),
		}),
	);

describe("entity interest socket session", () => {
	it.effect(
		"authenticates, acknowledges commands while reconciliation is blocked, and cleans up",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const activity: string[] = [];
					const reconciliationGate = yield* Deferred.make<void>();
					const socket = yield* makeSocket();
					const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
						Effect.provide(makeLayer(activity, reconciliationGate)),
						Effect.forkChild,
					);
					yield* Deferred.await(socket.opened);
					yield* socket.send(
						encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
					);
					const ready = yield* socket.nextMessage();
					if (ready.type !== "ready") {
						return yield* Effect.die("expected ready message");
					}

					yield* socket.send(
						encodeEntityInterestClientMessage({
							revision: 1,
							type: "replace",
							entityIds: ["entity-1"],
						}),
					);
					expect(yield* socket.nextMessage()).toEqual({ revision: 1, type: "applied" });
					yield* socket.send(
						encodeEntityInterestClientMessage({
							remove: [],
							revision: 2,
							type: "update",
							add: ["entity-2"],
						}),
					);
					expect(yield* socket.nextMessage()).toEqual({ revision: 2, type: "applied" });

					yield* socket.remoteClose;
					yield* Fiber.await(fiber);
					const sessionId = ready.sessionId;
					expect(activity).toEqual([
						`open:${sessionId}`,
						`add:${sessionId}`,
						`remove:${sessionId}`,
						`close:${sessionId}`,
					]);
					return undefined;
				}),
			),
	);

	it.effect("uses the generic policy close for an invalid ticket", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const socket = yield* makeSocket();
				const layer = Layer.mergeAll(
					Layer.mock(EntityInterestTicketService)({
						consume: () => Effect.fail(new EntityInterestInvalidTicket()),
					}),
					Layer.mock(EntityInterestStore)({}),
					Layer.mock(InterestService)({}),
					Layer.mock(LocalInterestSessions)({}),
				);
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(layer),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "invalid", type: "authenticate" }),
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

	it.effect("uses the internal-error close when the ticket store is unavailable", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const socket = yield* makeSocket();
				const layer = Layer.mergeAll(
					Layer.mock(EntityInterestTicketService)({
						consume: () =>
							Effect.fail(
								new EntityInterestTicketFailure({ reason: { code: "ticket-store-unavailable" } }),
							),
					}),
					Layer.mock(EntityInterestStore)({}),
					Layer.mock(InterestService)({}),
					Layer.mock(LocalInterestSessions)({}),
				);
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(layer),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
				);
				const close = yield* Queue.take(socket.writes);
				expect(Socket.isCloseEvent(close) && close.code).toBe(1011);
				expect(Socket.isCloseEvent(close) && close.reason).toBe("Internal error");
				yield* Fiber.await(fiber);
			}),
		),
	);

	it.effect("does not process pipelined commands until ready has been written", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const activity: string[] = [];
				const readyWriteGate = yield* Deferred.make<void>();
				const reconciliationGate = yield* Deferred.make<void>();
				let replacements = 0;
				const socket = yield* makeSocket(readyWriteGate);
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(
						makeLayer(activity, reconciliationGate, {
							onReplace: () => {
								replacements += 1;
							},
						}),
					),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
				);
				yield* socket.send(
					encodeEntityInterestClientMessage({
						revision: 1,
						type: "replace",
						entityIds: ["entity-1"],
					}),
				);

				expect((yield* socket.nextMessage()).type).toBe("ready");
				yield* Effect.yieldNow;
				expect(replacements).toBe(0);
				yield* Deferred.succeed(readyWriteGate, undefined);
				expect(yield* socket.nextMessage()).toEqual({ revision: 1, type: "applied" });
				yield* socket.remoteClose;
				yield* Fiber.await(fiber);
			}),
		),
	);

	it.effect("cleans up when the writer fails before acknowledging ready", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const activity: string[] = [];
				const reconciliationGate = yield* Deferred.make<void>();
				const socket = yield* makeSocket(undefined, true);
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(makeLayer(activity, reconciliationGate)),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
				);
				const ready = yield* socket.nextMessage();
				if (ready.type !== "ready") {
					return yield* Effect.die("expected ready message");
				}

				yield* Fiber.await(fiber);
				expect(activity).toEqual([
					`open:${ready.sessionId}`,
					`add:${ready.sessionId}`,
					`remove:${ready.sessionId}`,
					`close:${ready.sessionId}`,
				]);
				return undefined;
			}),
		),
	);

	it.effect("stops processing buffered commands after a protocol error", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const activity: string[] = [];
				const reconciliationGate = yield* Deferred.make<void>();
				let replacements = 0;
				const socket = yield* makeSocket();
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(
						makeLayer(activity, reconciliationGate, {
							onReplace: () => {
								replacements += 1;
							},
						}),
					),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
				);
				expect((yield* socket.nextMessage()).type).toBe("ready");
				yield* socket.send(
					encodeEntityInterestClientMessage({
						remove: [],
						revision: 1,
						type: "update",
						add: ["invalid"],
					}),
				);
				yield* socket.send(
					encodeEntityInterestClientMessage({ revision: 1, entityIds: [], type: "replace" }),
				);

				const close = yield* Queue.take(socket.writes);
				expect(Socket.isCloseEvent(close) && close.code).toBe(1002);
				yield* Fiber.await(fiber);
				expect(replacements).toBe(0);
			}),
		),
	);

	it.effect("closes on revision mismatch without processing another buffered command", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const activity: string[] = [];
				const reconciliationGate = yield* Deferred.make<void>();
				let replacements = 0;
				const socket = yield* makeSocket();
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(
						makeLayer(activity, reconciliationGate, {
							replaceOutcome: "revision-mismatch",
							onReplace: () => {
								replacements += 1;
							},
						}),
					),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
				);
				expect((yield* socket.nextMessage()).type).toBe("ready");
				yield* socket.send(
					encodeEntityInterestClientMessage({ revision: 1, entityIds: [], type: "replace" }),
				);
				yield* socket.send(
					encodeEntityInterestClientMessage({ revision: 1, entityIds: [], type: "replace" }),
				);

				const close = yield* Queue.take(socket.writes);
				expect(Socket.isCloseEvent(close) && close.code).toBe(1002);
				yield* Fiber.await(fiber);
				expect(replacements).toBe(1);
			}),
		),
	);

	it.effect("rejects over-limit commands without closing the session", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const activity: string[] = [];
				const reconciliationGate = yield* Deferred.make<void>();
				const socket = yield* makeSocket();
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(
						makeLayer(activity, reconciliationGate, { replaceOutcome: "limit-exceeded" }),
					),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
				);
				expect((yield* socket.nextMessage()).type).toBe("ready");
				yield* socket.send(
					encodeEntityInterestClientMessage({ revision: 1, entityIds: [], type: "replace" }),
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

	it.effect("drops terminal reconciliation from an obsolete pending token", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const activity: string[] = [];
				const markAttempted = yield* Deferred.make<void>();
				const socket = yield* makeSocket();
				const layer = Layer.mergeAll(
					Layer.mock(EntityInterestTicketService)({
						consume: () =>
							Effect.succeed({ preferredLanguage: null, userId: UserId.make("user-1") }),
					}),
					Layer.mock(EntityInterestStore)({
						closeSession: () => Effect.succeed(true),
						renewSession: () => Effect.succeed(true),
						openSession: () => Effect.sync(() => undefined),
						markReconciled: () => Deferred.succeed(markAttempted, undefined).pipe(Effect.as([])),
						replaceInterest: () =>
							Effect.succeed({
								revision: 1,
								status: "applied" as const,
								pending: [{ revision: 1, entityId: "entity-1" }],
							}),
					}),
					Layer.mock(InterestService)({
						reconcile: () =>
							Effect.succeed([
								{
									pending: { revision: 1, entityId: "entity-1" },
									message: {
										reason: "populated" as const,
										type: "entity-updated" as const,
										entityId: EntityId.make("entity-1"),
									},
								},
							]),
					}),
					Layer.mock(LocalInterestSessions)({ add: () => Effect.void, remove: () => Effect.void }),
				);
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(layer),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
				);
				expect((yield* socket.nextMessage()).type).toBe("ready");
				yield* socket.send(
					encodeEntityInterestClientMessage({
						revision: 1,
						type: "replace",
						entityIds: ["entity-1"],
					}),
				);
				expect(yield* socket.nextMessage()).toEqual({ revision: 1, type: "applied" });
				yield* Deferred.await(markAttempted);
				expect(yield* Queue.poll(socket.writes)).toEqual(Option.none());
				yield* socket.remoteClose;
				yield* Fiber.await(fiber);
				expect(activity).toEqual([]);
			}),
		),
	);

	it.effect("closes when a heartbeat pong does not arrive", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const activity: string[] = [];
				const reconciliationGate = yield* Deferred.make<void>();
				const socket = yield* makeSocket();
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(makeLayer(activity, reconciliationGate)),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
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

	it.effect("expires an authenticated session after 15 minutes and cleans up", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const activity: string[] = [];
				const reconciliationGate = yield* Deferred.make<void>();
				const socket = yield* makeSocket(undefined, false, true);
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(makeLayer(activity, reconciliationGate)),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
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
				expect(activity).toEqual([`open:${ready.sessionId}`, `add:${ready.sessionId}`]);

				yield* TestClock.adjust("1 second");
				const close = yield* Queue.take(socket.writes);
				assert(Socket.isCloseEvent(close));
				expect(close.code).toBe(4001);
				expect(close.reason).toBe("Session expired");
				yield* Fiber.await(fiber);
				expect(activity).toEqual([
					`open:${ready.sessionId}`,
					`add:${ready.sessionId}`,
					`remove:${ready.sessionId}`,
					`close:${ready.sessionId}`,
				]);
			}),
		),
	);

	it.effect("stops buffered commands when heartbeat shutdown interrupts the processor", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const activity: string[] = [];
				const replaceGate = yield* Deferred.make<void>();
				const replaceStarted = yield* Deferred.make<void>();
				const reconciliationGate = yield* Deferred.make<void>();
				let replacements = 0;
				const socket = yield* makeSocket();
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(
						makeLayer(activity, reconciliationGate, {
							replaceGate,
							replaceStarted,
							onReplace: () => {
								replacements += 1;
							},
						}),
					),
					Effect.forkChild,
				);
				yield* Deferred.await(socket.opened);
				yield* socket.send(
					encodeEntityInterestClientMessage({ ticket: "ticket", type: "authenticate" }),
				);
				expect((yield* socket.nextMessage()).type).toBe("ready");
				yield* socket.send(
					encodeEntityInterestClientMessage({ revision: 1, entityIds: [], type: "replace" }),
				);
				yield* Deferred.await(replaceStarted);
				yield* socket.send(
					encodeEntityInterestClientMessage({ revision: 2, entityIds: [], type: "replace" }),
				);

				yield* TestClock.adjust("25 seconds");
				expect((yield* socket.nextMessage()).type).toBe("ping");
				yield* TestClock.adjust("10 seconds");
				const close = yield* Queue.take(socket.writes);
				expect(Socket.isCloseEvent(close) && close.code).toBe(4000);
				yield* Fiber.await(fiber);
				expect(replacements).toBe(1);
			}),
		),
	);

	it.effect("closes unauthenticated sockets after exactly five seconds", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const socket = yield* makeSocket();
				const layer = Layer.mergeAll(
					Layer.mock(EntityInterestTicketService)({}),
					Layer.mock(EntityInterestStore)({}),
					Layer.mock(InterestService)({}),
					Layer.mock(LocalInterestSessions)({}),
				);
				const fiber = yield* runEntityInterestSocketSession(socket.socket).pipe(
					Effect.provide(layer),
					Effect.forkChild,
				);
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
