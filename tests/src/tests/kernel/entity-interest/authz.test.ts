import {
	decodeEntityInterestServerMessage,
	encodeEntityInterestClientMessage,
} from "@ryot/contract/modules/entity-interest/messages";
import { Duration, Effect, Result } from "effect";

import {
	createAuthenticatedClient,
	findBuiltinSchemaBySlug,
	getEntity,
	openInterestWebSocketScoped,
	seedMediaEntity,
	type Client,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

type SocketClose = { code: number; reason: string };

const createSocketTicket = (client: Client) =>
	client.call((contract) => contract["entity-interest"].createSocketTicket());

const waitForSocketClose = (firstFrame?: string, timeoutMs = 10_000) =>
	new Promise<SocketClose>((resolve, reject) => {
		const socket = new WebSocket(`${getBackendUrl()}/entity-interest/ws`);
		const timer = setTimeout(() => {
			socket.close();
			reject(new Error("Timed out waiting for entity interest WebSocket close"));
		}, timeoutMs);
		socket.addEventListener("open", () => {
			if (firstFrame !== undefined) {
				socket.send(firstFrame);
			}
		});
		socket.addEventListener("close", (event) => {
			clearTimeout(timer);
			resolve({ code: event.code, reason: event.reason });
		});
	});

const consumeTicket = (ticket: string) =>
	new Promise<void>((resolve, reject) => {
		const socket = new WebSocket(`${getBackendUrl()}/entity-interest/ws`);
		const timer = setTimeout(() => {
			socket.close();
			reject(new Error("Timed out consuming entity interest socket ticket"));
		}, 10_000);
		socket.addEventListener("open", () => {
			socket.send(encodeEntityInterestClientMessage({ type: "authenticate", ticket }));
		});
		socket.addEventListener("message", (event) => {
			const decoded = decodeEntityInterestServerMessage(String(event.data));
			if (Result.isSuccess(decoded) && decoded.success.type === "ready") {
				clearTimeout(timer);
				socket.close(1000);
				resolve();
			}
		});
	});

describe("interest authorization", () => {
	it.live("ignores interest declared in another user's private entity", () =>
		Effect.gen(function* () {
			const authA = yield* createAuthenticatedClient();
			const authB = yield* createAuthenticatedClient();

			const { schema } = yield* findBuiltinSchemaBySlug(authA.client, "company");
			const providerId = schema.providers.find(
				(provider) => provider.name === "Anilist",
			)?.providerId;
			assertPresent(providerId, "Anilist company provider not found");

			const privateEntity = yield* seedMediaEntity({
				providerId,
				properties: {},
				client: authA.client,
				userId: authA.userId,
				name: "A's Private Studio",
				entitySchemaSlug: schema.id,
				externalId: `private-${crypto.randomUUID()}`,
			});

			const socketB = yield* openInterestWebSocketScoped(authB);
			expect(yield* Effect.promise(() => socketB.replaceInterest([privateEntity.id]))).toEqual({
				revision: 1,
				type: "applied",
			});
			yield* Effect.promise(() =>
				socketB.expectNoEntityUpdated(privateEntity.id, { windowMs: 4000 }),
			);

			const entity = yield* getEntity(authA.client, privateEntity.id);
			expect(entity.populatedAt).toBeNull();
		}),
	);

	it.live("rejects an unauthenticated socket-ticket request", () =>
		Effect.gen(function* () {
			const response = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/entity-interest/socket-ticket`, { method: "POST" }),
			);
			expect(response.status).toBe(401);
		}),
	);

	it.live(
		"closes missing, expired, malformed, and reused tickets identically",
		() =>
			Effect.gen(function* () {
				const auth = yield* createAuthenticatedClient();
				const reused = yield* createSocketTicket(auth.client);
				yield* Effect.promise(() => consumeTicket(reused.ticket));
				const expired = yield* createSocketTicket(auth.client);
				yield* Effect.sleep(Duration.seconds(31));

				const closes = yield* Effect.promise(() =>
					Promise.all([
						waitForSocketClose(
							encodeEntityInterestClientMessage({ type: "authenticate", ticket: "A".repeat(43) }),
						),
						waitForSocketClose(
							encodeEntityInterestClientMessage({ type: "authenticate", ticket: expired.ticket }),
						),
						waitForSocketClose(
							encodeEntityInterestClientMessage({ type: "authenticate", ticket: "malformed" }),
						),
						waitForSocketClose(
							encodeEntityInterestClientMessage({ type: "authenticate", ticket: reused.ticket }),
						),
					]),
				);
				expect(closes).toEqual([
					{ code: 1008, reason: "Authentication failed" },
					{ code: 1008, reason: "Authentication failed" },
					{ code: 1008, reason: "Authentication failed" },
					{ code: 1008, reason: "Authentication failed" },
				]);
			}),
		60_000,
	);

	it.live("requires authentication as the first frame and before the deadline", () =>
		Effect.gen(function* () {
			const firstFrame = yield* Effect.promise(() =>
				waitForSocketClose(
					encodeEntityInterestClientMessage({ type: "replace", revision: 1, entityIds: [] }),
				),
			);
			const deadline = yield* Effect.promise(() => waitForSocketClose());
			expect(firstFrame).toEqual({ code: 1002, reason: "Protocol error" });
			expect(deadline).toEqual({ code: 1008, reason: "Authentication failed" });
		}),
	);
});
