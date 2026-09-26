import {
	decodeEntityInterestServerMessage,
	encodeEntityInterestClientMessage,
} from "@ryot-app/contract/modules/entity-interest/messages";
import { Duration, Effect, Result } from "effect";

import {
	createAuthenticatedClient,
	createApiKey,
	findBuiltinSchemaBySlug,
	getEntity,
	makeSession,
	openInterestWebSocketScoped,
	type Client,
} from "~/fixtures/kernel";
import { seedMediaEntity } from "~/fixtures/plugins/media";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";

type SocketClose = { code: number; reason: string };

const createSocketTicket = (client: Client) =>
	client.call((contract) => contract["entity-interest"].createSocketTicket());

const waitForSocketClose = (firstFrame?: string, timeoutMs = 10_000) =>
	new Promise<SocketClose>((resolve, reject) => {
		const socket = new WebSocket(`${getApiUrl()}/entity-interest/ws`);
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
		const socket = new WebSocket(`${getApiUrl()}/entity-interest/ws`);
		const timer = setTimeout(() => {
			socket.close();
			reject(new Error("Timed out consuming entity interest socket ticket"));
		}, 10_000);
		socket.addEventListener("open", () => {
			socket.send(encodeEntityInterestClientMessage({ ticket, type: "authenticate" }));
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
				fetch(`${getApiUrl()}/entity-interest/socket-ticket`, { method: "POST" }),
			);
			expect(response.status).toBe(401);
		}),
	);

	it.live("authenticates a socket ticket and WebSocket with an API key", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const apiKey = yield* createApiKey(auth.sessionCookie);
			const socket = yield* openInterestWebSocketScoped({
				client: makeSession(getApiUrl(), { "X-Api-Key": apiKey }),
			});
			expect(socket.ready.sessionId).toEqual(expect.any(String));
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
							encodeEntityInterestClientMessage({ ticket: "malformed", type: "authenticate" }),
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
					encodeEntityInterestClientMessage({ revision: 1, entityIds: [], type: "replace" }),
				),
			);
			const deadline = yield* Effect.promise(() => waitForSocketClose());
			expect(firstFrame).toEqual({ code: 1002, reason: "Protocol error" });
			expect(deadline).toEqual({ code: 1008, reason: "Authentication failed" });
		}),
	);
});
