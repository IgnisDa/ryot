import {
	decodeEntityInterestServerMessage,
	encodeEntityInterestClientMessage,
	type EntityInterestAppliedMessage,
	type EntityInterestEntityUpdatedMessage,
	type EntityInterestReadyMessage,
} from "@ryot-app/contract/modules/entity-interest/messages";
import { Effect, Result } from "effect";

import { getApiUrl } from "~/support/api";

import type { ContractSession } from "./contract-client";

type WaitOptions = { timeoutMs?: number };
type EntityUpdatedWaiter = {
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	onMessage: (message: EntityInterestEntityUpdatedMessage) => void;
};

type InterestWebSocket = {
	close: () => Promise<void>;
	readonly ready: EntityInterestReadyMessage;
	getEntityUpdatedMessages: () => readonly EntityInterestEntityUpdatedMessage[];
	replaceInterest: (entityIds: readonly string[]) => Promise<EntityInterestAppliedMessage>;
	expectNoEntityUpdated: (entityId: string, options: { windowMs: number }) => Promise<void>;
	updateInterest: (input: {
		readonly add: readonly string[];
		readonly remove: readonly string[];
	}) => Promise<EntityInterestAppliedMessage>;
	waitForEntityUpdated: (
		entityId: string,
		reason?: EntityInterestEntityUpdatedMessage["reason"],
		options?: WaitOptions,
	) => Promise<EntityInterestEntityUpdatedMessage>;
};

const isEntityUpdatedMatch = (
	message: EntityInterestEntityUpdatedMessage,
	entityId: string,
	reason?: EntityInterestEntityUpdatedMessage["reason"],
) => message.entityId === entityId && (reason === undefined || message.reason === reason);

export async function openInterestWebSocket(
	auth: { client: ContractSession },
	options: WaitOptions = {},
): Promise<InterestWebSocket> {
	const { ticket } = await Effect.runPromise(
		auth.client.call((contract) => contract["entity-interest"].createSocketTicket()),
	);
	const url = `${getApiUrl()}/entity-interest/ws`;
	const socket = new WebSocket(url);
	const timeoutMs = options.timeoutMs ?? 10_000;

	let expectedClose = false;
	let failure: Error | null = null;
	let revision = 0;
	let commandQueue = Promise.resolve();
	const messages: EntityInterestEntityUpdatedMessage[] = [];
	const listeners = new Set<EntityUpdatedWaiter>();
	const acknowledgements = new Map<
		number,
		{
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
			resolve: (message: EntityInterestAppliedMessage) => void;
		}
	>();
	const {
		promise: ready,
		resolve: resolveReady,
		reject: rejectReady,
	} = Promise.withResolvers<EntityInterestReadyMessage>();
	const {
		promise: closed,
		resolve: resolveClosed,
		reject: rejectClosed,
	} = Promise.withResolvers<void>();
	void closed.catch(() => undefined);

	const fail = (error: Error) => {
		if (failure) {
			return;
		}
		failure = error;
		rejectReady(error);
		for (const acknowledgement of acknowledgements.values()) {
			clearTimeout(acknowledgement.timer);
			acknowledgement.reject(error);
		}
		acknowledgements.clear();
		for (const listener of listeners) {
			clearTimeout(listener.timer);
			listener.reject(error);
		}
		listeners.clear();
	};

	socket.addEventListener("open", () => {
		socket.send(encodeEntityInterestClientMessage({ type: "authenticate", ticket }));
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
			rejectClosed(error);
			return;
		}
		resolveClosed();
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
			resolveReady(message);
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
		clearTimeout(acknowledgement.timer);
		acknowledgements.delete(message.revision);
		if (message.type === "rejected") {
			const error = new Error(
				`Entity interest revision ${message.revision} was rejected: ${message.code}`,
			);
			fail(error);
			acknowledgement.reject(error);
			socket.close(1002, "Command rejected");
			return;
		}
		acknowledgement.resolve(message);
	});

	const readyTimer = setTimeout(() => {
		fail(new Error("Entity interest WebSocket did not become ready in time"));
		socket.close(1002, "Ready timeout");
	}, timeoutMs);
	const readyMessage = await ready.finally(() => clearTimeout(readyTimer));

	const sendCommand = (
		message:
			| { readonly type: "replace"; readonly entityIds: readonly string[] }
			| {
					readonly type: "update";
					readonly add: readonly string[];
					readonly remove: readonly string[];
			  },
	): Promise<EntityInterestAppliedMessage> => {
		const previous = commandQueue;
		const next = Promise.withResolvers<void>();
		commandQueue = next.promise;
		return previous
			.then(
				() =>
					new Promise<EntityInterestAppliedMessage>((resolve, reject) => {
						if (failure) {
							reject(failure);
							return;
						}
						revision += 1;
						const commandRevision = revision;
						const timer = setTimeout(() => {
							acknowledgements.delete(commandRevision);
							const error = new Error(`Timed out waiting for applied revision ${commandRevision}`);
							fail(error);
							reject(error);
							socket.close(1002, "Acknowledgement timeout");
						}, timeoutMs);
						acknowledgements.set(commandRevision, { resolve, reject, timer });
						socket.send(
							encodeEntityInterestClientMessage({ ...message, revision: commandRevision }),
						);
					}),
			)
			.finally(() => next.resolve());
	};

	const waitForEntityUpdated = (
		entityId: string,
		reason?: EntityInterestEntityUpdatedMessage["reason"],
		waitOptions: WaitOptions = {},
	): Promise<EntityInterestEntityUpdatedMessage> =>
		new Promise((resolve, reject) => {
			if (failure) {
				reject(failure);
				return;
			}
			const existing = messages.find((message) => isEntityUpdatedMatch(message, entityId, reason));
			if (existing) {
				resolve(existing);
				return;
			}
			const waiter: EntityUpdatedWaiter = {
				reject,
				timer: setTimeout(() => {
					listeners.delete(waiter);
					reject(
						new Error(
							`Timed out waiting for entity-updated for '${entityId}' on session '${readyMessage.sessionId}'`,
						),
					);
				}, waitOptions.timeoutMs ?? 90_000),
				onMessage: (message: EntityInterestEntityUpdatedMessage) => {
					if (isEntityUpdatedMatch(message, entityId, reason)) {
						clearTimeout(waiter.timer);
						listeners.delete(waiter);
						resolve(message);
					}
				},
			};
			listeners.add(waiter);
		});

	const expectNoEntityUpdated = (
		entityId: string,
		{ windowMs }: { windowMs: number },
	): Promise<void> =>
		new Promise((resolve, reject) => {
			if (failure) {
				reject(failure);
				return;
			}
			if (messages.some((message) => isEntityUpdatedMatch(message, entityId))) {
				reject(new Error(`Unexpected early entity-updated for '${entityId}'`));
				return;
			}
			const waiter: EntityUpdatedWaiter = {
				reject,
				timer: setTimeout(() => {
					listeners.delete(waiter);
					resolve();
				}, windowMs),
				onMessage: (message: EntityInterestEntityUpdatedMessage) => {
					if (isEntityUpdatedMatch(message, entityId)) {
						clearTimeout(waiter.timer);
						listeners.delete(waiter);
						reject(new Error(`Unexpected entity-updated for '${entityId}'`));
					}
				},
			};
			listeners.add(waiter);
		});

	return {
		ready: readyMessage,
		waitForEntityUpdated,
		expectNoEntityUpdated,
		replaceInterest: (entityIds) => sendCommand({ type: "replace", entityIds }),
		updateInterest: (input) => sendCommand({ type: "update", ...input }),
		getEntityUpdatedMessages: () => messages.slice(),
		close: () => {
			if (failure) {
				return Promise.reject(failure);
			}
			expectedClose = true;
			if (socket.readyState === WebSocket.OPEN) {
				socket.close(1000);
			}
			return closed;
		},
	};
}

export const openInterestWebSocketScoped = (
	auth: { client: ContractSession },
	options: WaitOptions = {},
) =>
	Effect.acquireRelease(
		Effect.promise(() => openInterestWebSocket(auth, options)),
		(socket) => Effect.promise(() => socket.close()),
	);
