import {
	decodeEntityInterestServerMessage,
	encodeEntityInterestClientMessage,
	type EntityInterestAppliedMessage,
	type EntityInterestEntityUpdatedMessage,
	type EntityInterestReadyMessage,
	type EntityInterestRejectedMessage,
} from "@ryot-app/contract/modules/entity-interest/messages";
import { Effect, Exit, Result, Semaphore } from "effect";

import { getApiUrl } from "~/support/harness-target";

import type { ContractSession } from "./contract-client";

type WaitOptions = { timeoutMs?: number };
type EntityInterestCommandResult = EntityInterestAppliedMessage | EntityInterestRejectedMessage;
type EntityUpdatedWaiter = {
	reject: (error: Error) => void;
	onMessage: (message: EntityInterestEntityUpdatedMessage) => void;
};

type InterestWebSocket = {
	close: () => Effect.Effect<void>;
	readonly ready: EntityInterestReadyMessage;
	getEntityUpdatedMessages: () => readonly EntityInterestEntityUpdatedMessage[];
	replaceInterest: (entityIds: readonly string[]) => Effect.Effect<EntityInterestCommandResult>;
	expectNoEntityUpdated: (entityId: string, options: { windowMs: number }) => Effect.Effect<void>;
	updateInterest: (input: {
		readonly add: readonly string[];
		readonly remove: readonly string[];
	}) => Effect.Effect<EntityInterestCommandResult>;
	waitForEntityUpdated: (
		entityId: string,
		reason?: EntityInterestEntityUpdatedMessage["reason"],
		options?: WaitOptions,
	) => Effect.Effect<EntityInterestEntityUpdatedMessage>;
};

const isEntityUpdatedMatch = (
	message: EntityInterestEntityUpdatedMessage,
	entityId: string,
	reason?: EntityInterestEntityUpdatedMessage["reason"],
) => message.entityId === entityId && (reason === undefined || message.reason === reason);

export const openInterestWebSocket = (
	auth: { client: ContractSession },
	options: WaitOptions = {},
) =>
	Effect.gen(function* () {
		const { ticket } = yield* auth.client.call((contract) =>
			contract["entity-interest"].createSocketTicket(),
		);
		const url = `${getApiUrl()}/entity-interest/ws`;
		const socket = new WebSocket(url);
		const timeoutMs = options.timeoutMs ?? 10_000;

		let expectedClose = false;
		let failure: Error | null = null;
		let revision = 0;
		const commands = yield* Semaphore.make(1);
		let receivedReady: EntityInterestReadyMessage | undefined;
		let completeReady: ((result: Effect.Effect<EntityInterestReadyMessage>) => void) | undefined;
		let completeClose: ((result: Effect.Effect<void>) => void) | undefined;
		const messages: EntityInterestEntityUpdatedMessage[] = [];
		const listeners = new Set<EntityUpdatedWaiter>();
		const acknowledgements = new Map<
			number,
			{ reject: (error: Error) => void; resolve: (message: EntityInterestCommandResult) => void }
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
			socket.send(encodeEntityInterestClientMessage({ ticket, type: "authenticate" }));
		});
		socket.addEventListener("error", () => {
			fail(new Error("Entity interest WebSocket failed"));
			socket.close();
		});
		socket.addEventListener("close", (event) => {
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
			const decoded = decodeEntityInterestServerMessage(event.data);
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
				socket.send(encodeEntityInterestClientMessage({ type: "pong", nonce: message.nonce }));
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

		const readyMessage = yield* Effect.callback<EntityInterestReadyMessage>((resume) => {
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
				| { readonly type: "replace"; readonly entityIds: readonly string[] }
				| {
						readonly type: "update";
						readonly add: readonly string[];
						readonly remove: readonly string[];
				  },
		) =>
			commands.withPermit(
				Effect.gen(function* () {
					let commandRevision = 0;
					return yield* Effect.callback<EntityInterestCommandResult>((resume) => {
						if (failure) {
							resume(Effect.die(failure));
							return Effect.void;
						}
						commandRevision = revision + 1;
						acknowledgements.set(commandRevision, {
							reject: (error) => resume(Effect.die(error)),
							resolve: (value) => resume(Effect.succeed(value)),
						});
						socket.send(
							encodeEntityInterestClientMessage({ ...message, revision: commandRevision }),
						);
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
			reason?: EntityInterestEntityUpdatedMessage["reason"],
			waitOptions: WaitOptions = {},
		) =>
			Effect.callback<EntityInterestEntityUpdatedMessage>((resume) => {
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
					onMessage: (message: EntityInterestEntityUpdatedMessage) => {
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

		const expectNoEntityUpdated = (entityId: string, { windowMs }: { windowMs: number }) =>
			Effect.callback<void>((resume) => {
				if (failure) {
					resume(Effect.die(failure));
					return Effect.void;
				}
				if (messages.some((message) => isEntityUpdatedMatch(message, entityId))) {
					resume(Effect.die(new Error(`Unexpected early entity-updated for '${entityId}'`)));
					return Effect.void;
				}
				const waiter: EntityUpdatedWaiter = {
					reject: (error) => resume(Effect.die(error)),
					onMessage: (message: EntityInterestEntityUpdatedMessage) => {
						if (isEntityUpdatedMatch(message, entityId)) {
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

		return {
			ready: readyMessage,
			waitForEntityUpdated,
			expectNoEntityUpdated,
			getEntityUpdatedMessages: () => messages.slice(),
			updateInterest: (input) => sendCommand({ type: "update", ...input }),
			replaceInterest: (entityIds) => sendCommand({ entityIds, type: "replace" }),
			close: () =>
				Effect.callback<void>((resume) => {
					if (failure) {
						resume(Effect.die(failure));
						return Effect.void;
					}
					if (socket.readyState === WebSocket.CLOSED) {
						resume(Effect.void);
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
