import { assert, expect, layer } from "@effect/vitest";
import {
	OAUTH_DEMO_WEB_CLIENT_ID,
	OAUTH_WEB_CLIENT_ID,
	type StoredTokenSet,
} from "@ryot-app/contract/oauth";
import { Context, Deferred, Effect, Fiber, Layer, Queue } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { fakeOAuthStorageLayer } from "#/modules/auth/oauth-storage.test-support";
import { makeRuntimeOAuthClient, RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { OAuthTokenService, oauthTokenServiceLayer } from "#/modules/auth/token-service";
import { makeClientStorage } from "#/persistence/storage.test-layer";

const origin = decodeServerOrigin("https://authorization.test");
const now = 1_800_000_000_000;
const idToken = `header.${btoa(JSON.stringify({ nonce: "nonce" }))}.signature`;
const tokens = (accessToken: string, accessTokenExpiresAt = now + 900_000): StoredTokenSet => ({
	idToken,
	accessToken,
	tokenType: "Bearer",
	accessTokenExpiresAt,
	scope: "openid ryot:api",
	clientId: OAUTH_WEB_CLIENT_ID,
	refreshToken: `refresh-${accessToken}`,
});
const response = (accessToken: string) => ({
	expires_in: 900,
	id_token: idToken,
	token_type: "Bearer",
	scope: "openid ryot:api",
	access_token: accessToken,
	expires_at: now / 1000 + 900,
	refresh_token: `refresh-${accessToken}`,
});
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

type PendingRequest = {
	readonly url: string;
	readonly init: RequestInit | undefined;
	readonly reply: Deferred.Deferred<Response>;
};
class Endpoint extends Context.Service<
	Endpoint,
	{ readonly next: Effect.Effect<PendingRequest> }
>()("test/AuthorizationEndpoint") {}

const authorizationLayer = Layer.unwrap(
	Effect.gen(function* () {
		const requests = yield* Queue.unbounded<PendingRequest>();
		const context = yield* Effect.context();
		const fetcher: typeof fetch = (input, init) =>
			Effect.runPromiseWith(context)(
				Effect.gen(function* () {
					const reply = yield* Deferred.make<Response>();
					let url: string;
					if (typeof input === "string") {
						url = input;
					} else {
						url = input instanceof URL ? input.toString() : input.url;
					}
					yield* Queue.offer(requests, { url, init, reply });
					return yield* Deferred.await(reply);
				}),
			);
		const dependencies = Layer.mergeAll(
			oauthTokenServiceLayer(fetcher, () => now).pipe(Layer.provideMerge(fakeOAuthStorageLayer())),
			makeClientStorage(),
			Layer.effect(
				RuntimeOAuthClientService,
				makeRuntimeOAuthClient({
					isNative: () => false,
					getApplicationId: Effect.succeed("io.ryot.app"),
				}),
			),
		);
		return Layer.mergeAll(
			AuthService.layer.pipe(Layer.provideMerge(dependencies)),
			Layer.succeed(Endpoint, { next: Queue.take(requests) }),
		);
	}),
);

const pendingAuthorization = (clientId: StoredTokenSet["clientId"] = OAUTH_WEB_CLIENT_ID) => ({
	clientId,
	nonce: "nonce",
	createdAt: now,
	state: "replacement",
	serverOrigin: origin,
	destination: "/settings",
	codeVerifier: "verifier",
	redirectUri: `${origin}/auth/callback`,
});

const replaceAuthorization = Effect.fnUntraced(function* (
	accessToken: string,
	clientId: StoredTokenSet["clientId"] = OAUTH_WEB_CLIENT_ID,
) {
	const storage = yield* OAuthStorage;
	const service = yield* OAuthTokenService;
	const endpoint = yield* Endpoint;
	yield* storage.setPending(pendingAuthorization(clientId));
	const exchange = yield* Effect.forkChild(
		service.completeAuthorization(
			origin,
			[clientId],
			`${origin}/auth/callback`,
			"replacement",
			"code",
		),
	);
	const request = yield* endpoint.next;
	yield* Deferred.succeed(request.reply, json(response(accessToken)));
	yield* Fiber.join(exchange);
});

layer(authorizationLayer)((test) => {
	test.effect("rotation retains the settled profile and leaves other origins independent", () =>
		Effect.gen(function* () {
			const storage = yield* OAuthStorage;
			const service = yield* OAuthTokenService;
			const auth = yield* AuthService;
			const endpoint = yield* Endpoint;
			const other = decodeServerOrigin("https://other-authorization.test");
			yield* storage.setTokenSet(origin, tokens("profile-owner"));
			yield* storage.setTokenSet(other, tokens("other-owner"));
			for (const server of [origin, other]) {
				const resolution = yield* Effect.forkChild(auth.settledSession(server, true));
				const request = yield* endpoint.next;
				yield* Deferred.succeed(request.reply, json({ sub: server }));
				yield* Fiber.join(resolution);
			}
			const session = auth.session(origin);
			const before = session.getSnapshot();
			const snapshots: unknown[] = [];
			const unsubscribe = session.subscribe(() => snapshots.push(session.getSnapshot()));
			yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
			const refresh = yield* Effect.forkChild(service.accessToken(origin, true));
			const request = yield* endpoint.next;
			yield* Deferred.succeed(request.reply, json(response("rotated-profile-owner")));
			expect(yield* Fiber.join(refresh)).toBe("rotated-profile-owner");
			yield* auth.clearSession(other);
			expect(yield* auth.settledSession(origin)).toEqual(before);
			expect(session.getSnapshot()).toBe(before);
			expect(snapshots).toEqual([]);
			expect(auth.session(other).getSnapshot()).toEqual({ status: "missing" });
		}),
	);
});

layer(authorizationLayer)((test) => {
	test.effect("does not accept a code exchange after its authorization is cleared", () =>
		Effect.gen(function* () {
			const storage = yield* OAuthStorage;
			const service = yield* OAuthTokenService;
			const auth = yield* AuthService;
			const endpoint = yield* Endpoint;
			yield* storage.setPending(pendingAuthorization());
			const exchange = yield* Effect.forkChild(
				service
					.completeAuthorization(
						origin,
						[OAUTH_WEB_CLIENT_ID],
						`${origin}/auth/callback`,
						"replacement",
						"code",
					)
					.pipe(Effect.result),
			);
			const request = yield* endpoint.next;
			yield* auth.clearSession(origin);
			yield* Deferred.succeed(request.reply, json(response("stale")));
			const result = yield* Fiber.join(exchange);
			assert(result._tag === "Failure");
			expect(result.failure.reason).toBe("missing-authorization");
			expect(yield* storage.getTokenSet(origin)).toBeNull();
			expect(auth.session(origin).getSnapshot()).toEqual({ status: "missing" });
		}),
	);
});

layer(authorizationLayer)((test) => {
	test.effect("does not restore cleared tokens when a detached refresh completes", () =>
		Effect.gen(function* () {
			const storage = yield* OAuthStorage;
			const service = yield* OAuthTokenService;
			const auth = yield* AuthService;
			const endpoint = yield* Endpoint;
			yield* storage.setTokenSet(origin, tokens("old", now));
			const refresh = yield* Effect.forkChild(service.accessToken(origin));
			const request = yield* endpoint.next;
			yield* auth.clearSession(origin);
			yield* Deferred.succeed(request.reply, json(response("stale")));
			expect(yield* Fiber.join(refresh)).toBeNull();
			expect(yield* storage.getTokenSet(origin)).toBeNull();
			expect(auth.session(origin).getSnapshot()).toEqual({ status: "missing" });
		}),
	);
});

layer(authorizationLayer)((test) => {
	test.effect("does not remove a replacement authorization after stale invalid_grant", () =>
		Effect.gen(function* () {
			const storage = yield* OAuthStorage;
			const service = yield* OAuthTokenService;
			const endpoint = yield* Endpoint;
			yield* storage.setTokenSet(origin, tokens("old", now));
			const refresh = yield* Effect.forkChild(service.accessToken(origin));
			const request = yield* endpoint.next;
			yield* replaceAuthorization("replacement");
			yield* Deferred.succeed(request.reply, json({ error: "invalid_grant" }, 400));
			expect(yield* Fiber.join(refresh)).toBe("replacement");
			expect((yield* storage.getTokenSet(origin))?.accessToken).toBe("replacement");
		}),
	);
});

layer(authorizationLayer)((test) => {
	test.effect("a replacement forced refresh never joins its predecessor", () =>
		Effect.gen(function* () {
			const storage = yield* OAuthStorage;
			const service = yield* OAuthTokenService;
			const endpoint = yield* Endpoint;
			yield* storage.setTokenSet(origin, tokens("old", now));
			const oldRefresh = yield* Effect.forkChild(service.accessToken(origin));
			const oldRequest = yield* endpoint.next;
			yield* replaceAuthorization("replacement");
			const freshRefresh = yield* Effect.forkChild(service.accessToken(origin, true));
			const freshRequest = yield* endpoint.next;
			assert(freshRequest.init?.body instanceof URLSearchParams);
			expect(freshRequest.init.body.get("refresh_token")).toBe("refresh-replacement");
			yield* Deferred.succeed(freshRequest.reply, json(response("rotated-replacement")));
			expect(yield* Fiber.join(freshRefresh)).toBe("rotated-replacement");
			yield* Deferred.succeed(oldRequest.reply, json(response("stale")));
			expect(yield* Fiber.join(oldRefresh)).toBe("rotated-replacement");
			expect((yield* storage.getTokenSet(origin))?.accessToken).toBe("rotated-replacement");
		}),
	);
});

for (const change of ["clear", "replace"] as const) {
	layer(authorizationLayer)((test) => {
		test.effect(`does not publish late UserInfo after ${change}`, () =>
			Effect.gen(function* () {
				const storage = yield* OAuthStorage;
				const auth = yield* AuthService;
				const endpoint = yield* Endpoint;
				const session = auth.session(origin);
				const snapshots: unknown[] = [];
				yield* storage.setTokenSet(origin, tokens("old"));
				const initial = yield* Effect.forkChild(auth.settledSession(origin));
				const initialRequest = yield* endpoint.next;
				yield* Deferred.succeed(initialRequest.reply, json({ name: "Old", sub: "old-user" }));
				expect(yield* Fiber.join(initial)).toMatchObject({
					status: "authenticated",
					user: { id: "old-user" },
				});
				const oldResolution = yield* Effect.forkChild(auth.settledSession(origin, true));
				const oldRequest = yield* endpoint.next;
				const unsubscribe = session.subscribe(() => snapshots.push(session.getSnapshot()));
				yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
				expect(new Headers(oldRequest.init?.headers).get("authorization")).toBe("Bearer old");
				if (change === "clear") {
					yield* auth.clearSession(origin);
				} else {
					yield* replaceAuthorization("replacement", OAUTH_DEMO_WEB_CLIENT_ID);
					const newResolution = yield* Effect.forkChild(auth.settledSession(origin, true));
					const newRequest = yield* endpoint.next;
					expect(new Headers(newRequest.init?.headers).get("authorization")).toBe(
						"Bearer replacement",
					);
					yield* Deferred.succeed(newRequest.reply, json({ name: "New", sub: "new-user" }));
					expect(yield* Fiber.join(newResolution)).toMatchObject({
						accessClass: "demo",
						status: "authenticated",
						user: { id: "new-user" },
					});
				}
				yield* Deferred.succeed(oldRequest.reply, json({ name: "Old", sub: "old-user" }));
				expect(yield* Fiber.join(oldResolution)).toEqual(session.getSnapshot());
				expect(snapshots).toEqual(
					change === "clear"
						? [{ status: "missing" }]
						: [
								{ status: "pending" },
								{
									accessClass: "demo",
									status: "authenticated",
									user: { email: "", name: "New", image: null, id: "new-user" },
								},
							],
				);
			}),
		);
	});
}
