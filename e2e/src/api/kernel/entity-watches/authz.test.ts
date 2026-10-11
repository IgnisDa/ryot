import {
	decodeEntityWatchServerMessage,
	encodeEntityWatchClientMessage,
} from "@ryot-app/contract/modules/entity-watches/messages";
import { OAUTH_IMPERSONATION_WEB_CLIENT_ID } from "@ryot-app/contract/oauth";
import { Duration, Effect, Result } from "effect";

import {
	type Client,
	createApiKey,
	createAuthenticatedClient,
	createImpersonationSession,
	endImpersonationSession,
	fakeProviderDetailsResult,
	getEntity,
	installTestProvider,
	makeSession,
	openInterestWebSocketScoped,
	seedEntity,
	testProviderEntitySchema,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

type SocketClose = { code: number; reason: string };

const createSocketTicket = (client: Client) =>
	client.call((contract) => contract["entity-watches"].createSocketTicket());

const waitForSocketClose = (firstFrame?: string, timeoutMs = 10_000) =>
	Effect.callback<SocketClose>((resume) => {
		const socket = new WebSocket(`${getApiUrl()}/entity-watches/ws`);
		socket.addEventListener("open", () => {
			if (firstFrame !== undefined) {
				socket.send(firstFrame);
			}
		});
		socket.addEventListener("close", (event) => {
			resume(Effect.succeed({ code: event.code, reason: event.reason }));
		});
		return Effect.sync(() => {
			socket.close();
		});
	}).pipe(
		Effect.timeoutOrElse({
			duration: Duration.millis(timeoutMs),
			orElse: () => Effect.die(new Error("Timed out waiting for entity interest WebSocket close")),
		}),
	);

const consumeTicket = (ticket: string) =>
	Effect.callback<void>((resume) => {
		const socket = new WebSocket(`${getApiUrl()}/entity-watches/ws`);
		socket.addEventListener("open", () => {
			socket.send(encodeEntityWatchClientMessage({ ticket, type: "authenticate" }));
		});
		socket.addEventListener("message", (event) => {
			const decoded = decodeEntityWatchServerMessage(String(event.data));
			if (Result.isSuccess(decoded) && decoded.success.type === "ready") {
				socket.close(1000);
				resume(Effect.void);
			}
		});
		return Effect.sync(() => {
			socket.close();
		});
	}).pipe(
		Effect.timeoutOrElse({
			duration: Duration.seconds(10),
			orElse: () => Effect.die(new Error("Timed out consuming entity interest socket ticket")),
		}),
	);

describe("interest authorization", () => {
	it.live("ignores interest declared in another user's private entity", () =>
		Effect.gen(function* () {
			const authA = yield* createAuthenticatedClient();
			const authB = yield* createAuthenticatedClient();

			const provider = yield* Effect.acquireRelease(
				installTestProvider({
					client: authA.client,
					rootEntitySchemaSlug: "studio",
					details: fakeProviderDetailsResult({ name: "Populated Private Studio" }),
				}),
				uninstallTestProvider,
			);

			const privateEntity = yield* seedEntity({
				properties: {},
				client: authA.client,
				userId: authA.userId,
				name: "A's Private Studio",
				providerId: provider.providerId,
				externalId: `private-${crypto.randomUUID()}`,
				entitySchema: testProviderEntitySchema(provider),
			});

			const socketB = yield* openInterestWebSocketScoped(authB);
			expect(yield* socketB.replaceInterest([privateEntity.id])).toEqual({
				revision: 1,
				type: "applied",
			});
			yield* socketB.expectNoEntityUpdated(privateEntity.id, { windowMs: 4000 });

			const entity = yield* getEntity(authA.client, privateEntity.id);
			expect(entity.populatedAt).toBeNull();
		}),
	);

	it.live("rejects an unauthenticated socket-ticket request", () =>
		Effect.gen(function* () {
			const response = yield* webRequest(`${getApiUrl()}/entity-watches/socket-ticket`, {
				method: "POST",
			});
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

	it.live("closes an impersonation WebSocket when its session ends", () =>
		Effect.gen(function* () {
			const target = yield* createAuthenticatedClient();
			const impersonation = yield* createImpersonationSession(
				target.userId,
				OAUTH_IMPERSONATION_WEB_CLIENT_ID,
			);
			const socket = yield* openInterestWebSocketScoped({ client: impersonation.client });
			const ended = yield* endImpersonationSession(impersonation);
			expect(ended.status).toBe(302);
			expect(yield* socket.waitForClose({ timeoutMs: 10_000 })).toMatchObject({ code: 4001 });
		}),
	);

	it.live("closes missing, expired, malformed, and reused tickets identically", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const reused = yield* createSocketTicket(auth.client);
			yield* consumeTicket(reused.ticket);
			const expired = yield* createSocketTicket(auth.client);
			yield* Effect.sleep(Duration.seconds(31));

			const closes = yield* Effect.all(
				[
					waitForSocketClose(
						encodeEntityWatchClientMessage({ type: "authenticate", ticket: "A".repeat(43) }),
					),
					waitForSocketClose(
						encodeEntityWatchClientMessage({ type: "authenticate", ticket: expired.ticket }),
					),
					waitForSocketClose(
						encodeEntityWatchClientMessage({ ticket: "malformed", type: "authenticate" }),
					),
					waitForSocketClose(
						encodeEntityWatchClientMessage({ type: "authenticate", ticket: reused.ticket }),
					),
				],
				{ concurrency: "unbounded" },
			);
			expect(closes).toEqual([
				{ code: 1008, reason: "Authentication failed" },
				{ code: 1008, reason: "Authentication failed" },
				{ code: 1008, reason: "Authentication failed" },
				{ code: 1008, reason: "Authentication failed" },
			]);
		}),
	);

	it.live("requires authentication as the first frame and before the deadline", () =>
		Effect.gen(function* () {
			const firstFrame = yield* waitForSocketClose(
				encodeEntityWatchClientMessage({ revision: 1, entityIds: [], type: "replace" }),
			);
			const deadline = yield* waitForSocketClose();
			expect(firstFrame).toEqual({ code: 1002, reason: "Protocol error" });
			expect(deadline).toEqual({ code: 1008, reason: "Authentication failed" });
		}),
	);
});
