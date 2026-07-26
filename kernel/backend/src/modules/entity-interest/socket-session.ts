import { defaultUserPreferences, type CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	decodeEntityInterestClientMessage,
	encodeEntityInterestServerMessage,
	MAX_INTEREST_ENTITY_IDS,
	type EntityInterestClientMessage,
	type EntityInterestEntityUpdatedMessage,
	type EntityInterestServerMessage,
} from "@ryot/contract/modules/entity-interest/messages";
import { Deferred, Duration, Effect, Fiber, Option, Queue, Result, Schedule } from "effect";
import * as Socket from "effect/unstable/socket/Socket";

import { ENTITY_INTEREST_SESSION_RENEWAL_INTERVAL_SECONDS } from "#lib/infrastructure/redis";

import { LocalInterestSessions } from "./connections";
import { InterestService, type ReconciledCompletion } from "./service";
import { EntityInterestStore, type PendingInterest } from "./store";
import { EntityInterestTicketService } from "./ticket-service";

const ENTITY_INTEREST_HEARTBEAT_TIMEOUT = Duration.seconds(10);
const ENTITY_INTEREST_HEARTBEAT_INTERVAL = Duration.seconds(25);
const ENTITY_INTEREST_AUTHENTICATION_TIMEOUT = Duration.seconds(5);

const INBOUND_QUEUE_CAPACITY = 16;
const NORMAL_CLOSE = new Socket.CloseEvent(1000);
const PROTOCOL_ERROR = new Socket.CloseEvent(1002, "Protocol error");
const INTERNAL_ERROR = new Socket.CloseEvent(1011, "Internal error");
const HEARTBEAT_ERROR = new Socket.CloseEvent(4000, "Heartbeat timeout");
const AUTHENTICATION_ERROR = new Socket.CloseEvent(1008, "Authentication failed");

type Outbound = Effect.Success<ReturnType<typeof makeOutbound>>;
type Completion = EntityInterestEntityUpdatedMessage | ReconciledCompletion;
type Control =
	| Socket.CloseEvent
	| { readonly message: EntityInterestServerMessage; readonly written?: Deferred.Deferred<void> };

const makeOutbound = Effect.fn("EntityInterestSocketSession.makeOutbound")(function* (
	write: (
		chunk: Uint8Array | string | Socket.CloseEvent,
	) => Effect.Effect<void, Socket.SocketError>,
	store: EntityInterestStore["Service"],
	sessionId: string,
) {
	let accepting = true;
	let closed = false;
	const completions = new Map<string, Completion>();
	const controls = yield* Queue.unbounded<Control>();
	const wake = yield* Queue.dropping<void>(1);
	const stopped = yield* Deferred.make<void>();
	const shutdown = yield* Deferred.make<void>();

	const signal = () => Queue.offerUnsafe(wake, undefined);
	const enqueue = (message: EntityInterestServerMessage) =>
		accepting
			? Queue.offer(controls, { message }).pipe(
					Effect.tap(() => Effect.sync(signal)),
					Effect.asVoid,
				)
			: Effect.void;
	const enqueueAndWait = Effect.fn(function* (message: EntityInterestServerMessage) {
		if (!accepting) {
			return false;
		}
		const written = yield* Deferred.make<void>();
		yield* Queue.offer(controls, { message, written });
		signal();
		return yield* Effect.raceFirst(
			Deferred.await(written).pipe(Effect.as(true)),
			Deferred.await(stopped).pipe(Effect.as(false)),
		);
	});
	const enqueueCompletion = (completion: Completion) => {
		if (!accepting) {
			return;
		}
		const message = "message" in completion ? completion.message : completion;
		const existing = completions.get(message.entityId);
		const existingMessage = existing && ("message" in existing ? existing.message : existing);
		if (existingMessage?.reason === "translated") {
			return;
		}
		if (existing === undefined && completions.size >= MAX_INTEREST_ENTITY_IDS) {
			return;
		}
		completions.set(message.entityId, completion);
		signal();
	};
	const signalShutdown = Deferred.succeed(shutdown, undefined).pipe(Effect.asVoid);
	const close = (event: Socket.CloseEvent) =>
		Effect.uninterruptible(
			Effect.suspend(() => {
				if (!accepting) {
					return signalShutdown;
				}
				accepting = false;
				return signalShutdown.pipe(
					Effect.andThen(Queue.offer(controls, event)),
					Effect.tap(() => Effect.sync(signal)),
					Effect.asVoid,
				);
			}),
		);
	const run = Effect.gen(function* () {
		while (!closed) {
			yield* Queue.take(wake);
			while (!closed) {
				const control = yield* Queue.poll(controls);
				if (Option.isSome(control)) {
					if (Socket.isCloseEvent(control.value)) {
						closed = true;
						yield* write(control.value);
						yield* Deferred.succeed(stopped, undefined);
						continue;
					}
					yield* write(encodeEntityInterestServerMessage(control.value.message));
					if (control.value.written !== undefined) {
						yield* Deferred.succeed(control.value.written, undefined);
					}
					continue;
				}
				const completion = completions.entries().next().value;
				if (completion === undefined) {
					break;
				}
				completions.delete(completion[0]);
				const value = completion[1];
				if ("message" in value) {
					const marked = yield* store.markReconciled({ sessionId, pending: [value.pending] });
					if (!marked.includes(value.pending.entityId)) {
						continue;
					}
				}
				yield* write(encodeEntityInterestServerMessage("message" in value ? value.message : value));
			}
		}
	}).pipe(
		Effect.ensuring(
			signalShutdown.pipe(Effect.andThen(Deferred.succeed(stopped, undefined)), Effect.ignore),
		),
	);
	const stop = Effect.suspend(() => {
		accepting = false;
		completions.clear();
		if (closed) {
			return signalShutdown;
		}
		closed = true;
		return signalShutdown.pipe(Effect.andThen(write(NORMAL_CLOSE)), Effect.ignore);
	});

	return {
		run,
		stop,
		close,
		enqueue,
		enqueueAndWait,
		signalShutdown,
		enqueueCompletion,
		awaitClosed: Deferred.await(stopped),
		awaitShutdown: Deferred.await(shutdown),
	};
});

const closeBeforeAuthentication = (
	write: (
		chunk: Uint8Array | string | Socket.CloseEvent,
	) => Effect.Effect<void, Socket.SocketError>,
	event: Socket.CloseEvent,
) => write(event).pipe(Effect.ignore);

const makeReconciliationSchedule = () =>
	Schedule.exponential(Duration.seconds(1)).pipe(
		Schedule.modifyDelay(({ duration }) =>
			Effect.succeed(Duration.min(duration, Duration.seconds(30))),
		),
	);

const processCommand = Effect.fn("EntityInterestSocketSession.processCommand")(function* (
	message: EntityInterestClientMessage,
	sessionId: string,
	hasSnapshot: { value: boolean },
	store: EntityInterestStore["Service"],
	output: Outbound,
	submitPending: (pending: readonly PendingInterest[]) => Effect.Effect<void>,
) {
	if (message.type === "authenticate" || message.type === "pong") {
		return false;
	}
	if (!hasSnapshot.value && (message.type !== "replace" || message.revision !== 1)) {
		return false;
	}
	const outcome =
		message.type === "replace"
			? yield* store.replaceInterest({
					sessionId,
					revision: message.revision,
					entityIds: message.entityIds,
				})
			: yield* store.updateInterest({
					sessionId,
					add: message.add,
					remove: message.remove,
					revision: message.revision,
				});
	if (outcome.status === "limit-exceeded") {
		yield* output.enqueue({
			type: "rejected",
			revision: message.revision,
			code: "interest-limit-exceeded",
			maxEntityIds: MAX_INTEREST_ENTITY_IDS,
		});
		return true;
	}
	if (outcome.status !== "applied") {
		return false;
	}
	hasSnapshot.value = true;
	yield* output.enqueue({ type: "applied", revision: outcome.revision });
	yield* submitPending(outcome.pending);
	return true;
});

const runSocketSession = Effect.fn("EntityInterestSocketSession.run")(function* (
	socket: Socket.Socket,
) {
	const store = yield* EntityInterestStore;
	const service = yield* InterestService;
	const tickets = yield* EntityInterestTicketService;
	const sessions = yield* LocalInterestSessions;
	const write = yield* socket.writer;
	const inbound = yield* Queue.dropping<string | Uint8Array>(INBOUND_QUEUE_CAPACITY);
	const preAuthentication = { overflow: false };
	let closeForOverflow = () => closeBeforeAuthentication(write, PROTOCOL_ERROR);
	const readFiber = yield* socket
		.runRaw((frame) =>
			Queue.offer(inbound, frame).pipe(
				Effect.flatMap((accepted) => {
					if (accepted) {
						return Effect.void;
					}
					preAuthentication.overflow = true;
					return closeForOverflow();
				}),
			),
		)
		.pipe(Effect.forkScoped);
	const first = yield* Queue.take(inbound).pipe(
		Effect.timeoutOption(ENTITY_INTEREST_AUTHENTICATION_TIMEOUT),
	);
	if (Option.isNone(first)) {
		yield* closeBeforeAuthentication(write, AUTHENTICATION_ERROR);
		return;
	}
	if (typeof first.value !== "string") {
		yield* closeBeforeAuthentication(write, PROTOCOL_ERROR);
		return;
	}
	const decodedAuthentication = decodeEntityInterestClientMessage(first.value);
	if (
		Result.isFailure(decodedAuthentication) ||
		decodedAuthentication.success.type !== "authenticate"
	) {
		yield* closeBeforeAuthentication(write, PROTOCOL_ERROR);
		return;
	}
	const ticket = yield* tickets.consume(decodedAuthentication.success.ticket).pipe(Effect.result);
	if (Result.isFailure(ticket)) {
		yield* closeBeforeAuthentication(write, AUTHENTICATION_ERROR);
		return;
	}

	const sessionId = crypto.randomUUID();
	const user = {
		name: "",
		email: "",
		image: null,
		id: ticket.success.userId,
		preferences: { ...defaultUserPreferences, language: ticket.success.preferredLanguage },
	} satisfies CurrentUserValue;
	const output = yield* makeOutbound(write, store, sessionId);
	closeForOverflow = () => output.close(PROTOCOL_ERROR);
	if (preAuthentication.overflow) {
		return;
	}
	yield* store.openSession({
		sessionId,
		userId: user.id,
		preferredLanguage: user.preferences.language,
	});
	yield* sessions
		.add(sessionId, output.enqueueCompletion)
		.pipe(
			Effect.catchCause((cause) =>
				store.closeSession(sessionId).pipe(Effect.ignore, Effect.andThen(Effect.failCause(cause))),
			),
		);
	yield* Effect.addFinalizer(() =>
		output.stop.pipe(
			Effect.andThen(sessions.remove(sessionId, output.enqueueCompletion)),
			Effect.andThen(
				store
					.closeSession(sessionId)
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("entity interest session cleanup failed", cause).pipe(
								Effect.annotateLogs({ sessionId }),
							),
						),
					),
			),
		),
	);

	const reconciliation = yield* Queue.unbounded<readonly PendingInterest[]>();
	const reconciliationKeys = new Set<string>();
	const submitPending = (pending: readonly PendingInterest[]) => {
		const unique = pending.filter(({ entityId, revision }) => {
			const key = `${entityId}:${revision}`;
			if (reconciliationKeys.has(key)) {
				return false;
			}
			reconciliationKeys.add(key);
			return true;
		});
		return unique.length === 0
			? Effect.void
			: Queue.offer(reconciliation, unique).pipe(Effect.asVoid);
	};
	const reconciliationWorker = Effect.forever(
		Effect.gen(function* () {
			const pending = yield* Queue.take(reconciliation);
			const terminal = yield* service
				.reconcile({ sessionId, user, pending })
				.pipe(Effect.retry(makeReconciliationSchedule()));
			for (const item of pending) {
				reconciliationKeys.delete(`${item.entityId}:${item.revision}`);
			}
			for (const completion of terminal) {
				output.enqueueCompletion(completion);
			}
		}),
	);

	let heartbeatNonce: string | null = null;
	const heartbeatWorker = Effect.forever(
		Effect.sleep(ENTITY_INTEREST_HEARTBEAT_INTERVAL).pipe(
			Effect.andThen(
				Effect.gen(function* () {
					const nonce = crypto.randomUUID();
					heartbeatNonce = nonce;
					yield* output.enqueue({ type: "ping", nonce });
					yield* Effect.sleep(ENTITY_INTEREST_HEARTBEAT_TIMEOUT).pipe(
						Effect.andThen(
							Effect.suspend(() =>
								heartbeatNonce === nonce ? output.close(HEARTBEAT_ERROR) : Effect.void,
							),
						),
						Effect.forkChild,
					);
				}),
			),
		),
	);
	const renewalWorker = Effect.forever(
		Effect.sleep(Duration.seconds(ENTITY_INTEREST_SESSION_RENEWAL_INTERVAL_SECONDS)).pipe(
			Effect.andThen(store.renewSession(sessionId)),
			Effect.flatMap((renewed) => (renewed ? Effect.void : output.close(INTERNAL_ERROR))),
		),
	);
	const hasSnapshot = { value: false };
	const commandWorker = Effect.gen(function* () {
		for (;;) {
			const frame = yield* Queue.take(inbound);
			if (typeof frame !== "string") {
				yield* output.close(PROTOCOL_ERROR);
				break;
			}
			const decoded = decodeEntityInterestClientMessage(frame);
			if (Result.isFailure(decoded)) {
				yield* output.close(PROTOCOL_ERROR);
				break;
			}
			if (decoded.success.type === "pong") {
				if (heartbeatNonce === null || decoded.success.nonce !== heartbeatNonce) {
					yield* output.close(PROTOCOL_ERROR);
					break;
				}
				heartbeatNonce = null;
				continue;
			}
			const applied = yield* processCommand(
				decoded.success,
				sessionId,
				hasSnapshot,
				store,
				output,
				submitPending,
			);
			if (!applied) {
				yield* output.close(PROTOCOL_ERROR);
				break;
			}
		}
	}).pipe(
		Effect.catchCause((cause) =>
			Effect.logError("entity interest command processor failed", cause).pipe(
				Effect.annotateLogs({ sessionId }),
				Effect.andThen(output.close(INTERNAL_ERROR)),
			),
		),
	);

	yield* output.run.pipe(Effect.forkScoped);
	const readyWritten = yield* output.enqueueAndWait({
		sessionId,
		type: "ready",
		maxEntityIds: MAX_INTEREST_ENTITY_IDS,
		heartbeatIntervalMs: Duration.toMillis(ENTITY_INTEREST_HEARTBEAT_INTERVAL),
	});
	if (!readyWritten) {
		return;
	}
	yield* commandWorker.pipe(Effect.raceFirst(output.awaitShutdown), Effect.forkScoped);
	yield* reconciliationWorker.pipe(Effect.forkScoped);
	yield* heartbeatWorker.pipe(Effect.forkScoped);
	yield* renewalWorker.pipe(
		Effect.catchCause((cause) =>
			Effect.logError("entity interest session renewal failed", cause).pipe(
				Effect.annotateLogs({ sessionId }),
				Effect.andThen(output.close(INTERNAL_ERROR)),
			),
		),
		Effect.forkScoped,
	);
	yield* Effect.raceFirst(
		output.awaitClosed,
		Fiber.await(readFiber).pipe(
			Effect.tap(() => output.signalShutdown),
			Effect.asVoid,
		),
	);
});

export const runEntityInterestSocketSession = (socket: Socket.Socket) =>
	runSocketSession(socket).pipe(Effect.scoped);
