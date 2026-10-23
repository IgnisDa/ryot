import {
	decodeEntityWatchServerMessage,
	encodeEntityWatchClientMessage,
	type EntityWatchAppliedMessage,
	type EntityWatchEntityUpdatedMessage,
	type EntityWatchReadyMessage,
	type EntityWatchRejectedMessage,
} from "@ryot-app/contract/modules/entity-watches/messages";
import { Effect, Exit, Result, Semaphore } from "effect";

import { getApiUrl } from "~/support/harness-target";

import type { ContractSession } from "./contract-client";
import { getEntity } from "./entities";
import { pollUntil } from "./polling";

type WaitOptions = { timeoutMs?: number };
type SocketClose = { readonly code: number; readonly reason: string };
type EntityWatchCommandResult = EntityWatchAppliedMessage | EntityWatchRejectedMessage;
type EntityUpdatedWaiter = {
	reject: (error: Error) => void;
	onMessage: (message: EntityWatchEntityUpdatedMessage) => void;
};

type InterestWebSocket = {
	close: () => Effect.Effect<void>;
	readonly ready: EntityWatchReadyMessage;
	getEntityUpdatedMessages: () => readonly EntityWatchEntityUpdatedMessage[];
	waitForClose: (options?: WaitOptions) => Effect.Effect<SocketClose>;
	replaceInterest: (
		entityIds: readonly string[],
		foregroundIds?: readonly string[],
	) => Effect.Effect<EntityWatchCommandResult>;
	expectNoEntityUpdated: (
		entityId: string,
		options: { windowMs: number; reason?: EntityWatchEntityUpdatedMessage["reason"] },
	) => Effect.Effect<void>;
	updateInterest: (input: {
		readonly add: readonly string[];
		readonly remove: readonly string[];
		readonly addForeground?: readonly string[];
		readonly removeForeground?: readonly string[];
	}) => Effect.Effect<EntityWatchCommandResult>;
	waitForEntityUpdated: (
		entityId: string,
		reason?: EntityWatchEntityUpdatedMessage["reason"],
		options?: WaitOptions,
	) => Effect.Effect<EntityWatchEntityUpdatedMessage>;
};

const isEntityUpdatedMatch = (
	message: EntityWatchEntityUpdatedMessage,
	entityId: string,
	reason?: EntityWatchEntityUpdatedMessage["reason"],
) => message.entityId === entityId && (reason === undefined || message.reason === reason);

export const openInterestWebSocket = (
	auth: { client: ContractSession },
	options: WaitOptions = {},
) =>
	Effect.gen(function* () {
		const { ticket } = yield* auth.client.call((contract) =>
			contract["entity-watches"].createSocketTicket(),
		);
		const url = `${getApiUrl()}/entity-watches/ws`;
		const socket = new WebSocket(url);
		const timeoutMs = options.timeoutMs ?? 10_000;

		let expectedClose = false;
		let failure: Error | null = null;
		let closed: SocketClose | undefined;
		let revision = 0;
		const commands = yield* Semaphore.make(1);
		let receivedReady: EntityWatchReadyMessage | undefined;
		let completeReady: ((result: Effect.Effect<EntityWatchReadyMessage>) => void) | undefined;
		let completeClose: ((result: Effect.Effect<void>) => void) | undefined;
		const messages: EntityWatchEntityUpdatedMessage[] = [];
		const listeners = new Set<EntityUpdatedWaiter>();
		const closeListeners = new Set<(event: SocketClose) => void>();
		const acknowledgements = new Map<
			number,
			{ reject: (error: Error) => void; resolve: (message: EntityWatchCommandResult) => void }
		>();

		const fail = (error: Error) => {
			if (failure) {
				return;
			}
			failure = error;
			completeReady?.(Effect.die(error));
			for (const acknowledgement of acknowledgements.values()) {
				acknowledgement.reject(error);
			}
			acknowledgements.clear();
			for (const listener of listeners) {
				listener.reject(error);
			}
			listeners.clear();
		};

		socket.addEventListener("open", () => {
			socket.send(encodeEntityWatchClientMessage({ ticket, type: "authenticate" }));
		});
		socket.addEventListener("error", () => {
			fail(new Error("Entity interest WebSocket failed"));
			socket.close();
		});
		socket.addEventListener("close", (event) => {
			const close = { code: event.code, reason: event.reason };
			closed = close;
			for (const listener of closeListeners) {
				listener(close);
			}
			closeListeners.clear();
			if (!expectedClose || event.code !== 1000) {
				const error = new Error(
					`Entity interest WebSocket closed unexpectedly (${event.code}: ${event.reason})`,
				);
				fail(error);
				completeClose?.(Effect.die(error));
				return;
			}
			completeClose?.(Effect.void);
		});
		socket.addEventListener("message", (event) => {
			if (typeof event.data !== "string") {
				fail(new Error("Entity interest WebSocket received a non-text frame"));
				socket.close(1002, "Protocol error");
				return;
			}
			const decoded = decodeEntityWatchServerMessage(event.data);
			if (Result.isFailure(decoded)) {
				fail(new Error("Entity interest WebSocket received a malformed server message"));
				socket.close(1002, "Protocol error");
				return;
			}
			const message = decoded.success;
			if (message.type === "ready") {
				receivedReady = message;
				completeReady?.(Effect.succeed(message));
				return;
			}
			if (message.type === "ping") {
				socket.send(encodeEntityWatchClientMessage({ type: "pong", nonce: message.nonce }));
				return;
			}
			if (message.type === "entity-updated") {
				messages.push(message);
				for (const listener of listeners) {
					listener.onMessage(message);
				}
				return;
			}
			const acknowledgement = acknowledgements.get(message.revision);
			if (!acknowledgement) {
				fail(new Error(`Unexpected '${message.type}' for revision ${message.revision}`));
				socket.close(1002, "Protocol error");
				return;
			}
			acknowledgements.delete(message.revision);
			if (message.type === "applied") {
				revision = message.revision;
			}
			acknowledgement.resolve(message);
		});

		const readyMessage = yield* Effect.callback<EntityWatchReadyMessage>((resume) => {
			completeReady = resume;
			if (failure) {
				resume(Effect.die(failure));
			} else if (receivedReady) {
				resume(Effect.succeed(receivedReady));
			}
			return Effect.sync(() => {
				completeReady = undefined;
			});
		}).pipe(
			Effect.timeoutOrElse({
				duration: timeoutMs,
				orElse: () =>
					Effect.sync(() => {
						const error = new Error("Entity interest WebSocket did not become ready in time");
						fail(error);
						socket.close(1002, "Ready timeout");
						throw error;
					}),
			}),
			Effect.onExit((exit) =>
				Exit.isFailure(exit) ? Effect.sync(() => socket.close()) : Effect.void,
			),
		);

		const sendCommand = (
			message:
				| {
						readonly type: "replace";
						readonly entityIds: readonly string[];
						readonly foregroundIds: readonly string[];
				  }
				| {
						readonly type: "update";
						readonly add: readonly string[];
						readonly remove: readonly string[];
						readonly addForeground: readonly string[];
						readonly removeForeground: readonly string[];
				  },
		) =>
			commands.withPermit(
				Effect.gen(function* () {
					let commandRevision = 0;
					return yield* Effect.callback<EntityWatchCommandResult>((resume) => {
						if (failure) {
							resume(Effect.die(failure));
							return Effect.void;
						}
						commandRevision = revision + 1;
						acknowledgements.set(commandRevision, {
							reject: (error) => resume(Effect.die(error)),
							resolve: (value) => resume(Effect.succeed(value)),
						});
						socket.send(encodeEntityWatchClientMessage({ ...message, revision: commandRevision }));
						return Effect.sync(() => {
							acknowledgements.delete(commandRevision);
						});
					}).pipe(
						Effect.timeoutOrElse({
							duration: timeoutMs,
							orElse: () =>
								Effect.sync(() => {
									const error = new Error(`Timed out waiting for revision ${commandRevision}`);
									fail(error);
									socket.close(1002, "Acknowledgement timeout");
									throw error;
								}),
						}),
					);
				}),
			);

		const waitForEntityUpdated = (
			entityId: string,
			reason?: EntityWatchEntityUpdatedMessage["reason"],
			waitOptions: WaitOptions = {},
		) =>
			Effect.callback<EntityWatchEntityUpdatedMessage>((resume) => {
				if (failure) {
					resume(Effect.die(failure));
					return Effect.void;
				}
				const existing = messages.find((message) =>
					isEntityUpdatedMatch(message, entityId, reason),
				);
				if (existing) {
					resume(Effect.succeed(existing));
					return Effect.void;
				}
				const waiter: EntityUpdatedWaiter = {
					reject: (error) => resume(Effect.die(error)),
					onMessage: (message: EntityWatchEntityUpdatedMessage) => {
						if (isEntityUpdatedMatch(message, entityId, reason)) {
							listeners.delete(waiter);
							resume(Effect.succeed(message));
						}
					},
				};
				listeners.add(waiter);
				return Effect.sync(() => {
					listeners.delete(waiter);
				});
			}).pipe(
				Effect.timeoutOrElse({
					duration: waitOptions.timeoutMs ?? 90_000,
					orElse: () =>
						Effect.die(
							new Error(
								`Timed out waiting for entity-updated for '${entityId}' on session '${readyMessage.sessionId}'`,
							),
						),
				}),
			);

		const expectNoEntityUpdated = (
			entityId: string,
			{
				reason,
				windowMs,
			}: { windowMs: number; reason?: EntityWatchEntityUpdatedMessage["reason"] },
		) =>
			Effect.callback<void>((resume) => {
				if (failure) {
					resume(Effect.die(failure));
					return Effect.void;
				}
				if (messages.some((message) => isEntityUpdatedMatch(message, entityId, reason))) {
					resume(Effect.die(new Error(`Unexpected early entity-updated for '${entityId}'`)));
					return Effect.void;
				}
				const waiter: EntityUpdatedWaiter = {
					reject: (error) => resume(Effect.die(error)),
					onMessage: (message: EntityWatchEntityUpdatedMessage) => {
						if (isEntityUpdatedMatch(message, entityId, reason)) {
							listeners.delete(waiter);
							resume(Effect.die(new Error(`Unexpected entity-updated for '${entityId}'`)));
						}
					},
				};
				listeners.add(waiter);
				return Effect.sync(() => {
					listeners.delete(waiter);
				});
			}).pipe(Effect.timeoutOrElse({ duration: windowMs, orElse: () => Effect.void }));

		const waitForClose = (waitOptions: WaitOptions = {}) =>
			Effect.callback<SocketClose>((resume) => {
				if (closed !== undefined) {
					resume(Effect.succeed(closed));
					return Effect.void;
				}
				const listener = (event: SocketClose) => resume(Effect.succeed(event));
				closeListeners.add(listener);
				return Effect.sync(() => {
					closeListeners.delete(listener);
				});
			}).pipe(
				Effect.timeoutOrElse({
					duration: waitOptions.timeoutMs ?? 10_000,
					orElse: () =>
						Effect.die(new Error("Timed out waiting for entity interest WebSocket close")),
				}),
			);

		return {
			waitForClose,
			ready: readyMessage,
			waitForEntityUpdated,
			expectNoEntityUpdated,
			getEntityUpdatedMessages: () => messages.slice(),
			replaceInterest: (entityIds, foregroundIds = []) =>
				sendCommand({ entityIds, foregroundIds, type: "replace" }),
			updateInterest: ({ addForeground = [], removeForeground = [], ...input }) =>
				sendCommand({ ...input, addForeground, type: "update", removeForeground }),
			close: () =>
				Effect.callback<void>((resume) => {
					if (socket.readyState === WebSocket.CLOSED) {
						resume(Effect.void);
						return Effect.void;
					}
					if (failure) {
						resume(Effect.die(failure));
						return Effect.void;
					}
					completeClose = resume;
					expectedClose = true;
					if (socket.readyState === WebSocket.OPEN) {
						socket.close(1000);
					}
					return Effect.sync(() => {
						completeClose = undefined;
					});
				}),
		} satisfies InterestWebSocket;
	});

export const openInterestWebSocketScoped = (
	auth: { client: ContractSession },
	options: WaitOptions = {},
) => Effect.acquireRelease(openInterestWebSocket(auth, options), (socket) => socket.close());

export const populateRelatedThroughForegroundInterest = (
	auth: { client: ContractSession },
	entityId: string,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const socket = yield* openInterestWebSocketScoped(auth);
			yield* socket.replaceInterest([entityId], [entityId]);
			return yield* pollUntil(
				`entity '${entityId}' related level populated`,
				getEntity(auth.client, entityId).pipe(
					Effect.map((entity) => (entity.relatedPopulationStatus === "ready" ? entity : null)),
				),
			);
		}),
	);
