import { describe, expect, layer } from "@effect/vitest";
import {
	OAUTH_DEMO_WEB_CLIENT_ID,
	OAUTH_IMPERSONATION_WEB_CLIENT_ID,
	OAUTH_WEB_CLIENT_ID,
	type StoredTokenSet,
} from "@ryot-app/contract/oauth";
import { Context, Deferred, Effect, Fiber, Layer, Ref, Schema } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import {
	OAuthStorage,
	OAuthStorageError,
	oauthPendingKey,
	oauthTokenKey,
	type OAuthStorageAdapter,
} from "#/modules/auth/oauth-storage";
import { FakeOAuthStorage, fakeOAuthStorageLayer } from "#/modules/auth/oauth-storage.test-support";
import { OAuthTokenService, oauthTokenServiceLayer } from "#/modules/auth/token-service";

const origin = decodeServerOrigin("https://ryot.example");
const now = 1_800_000_000_000;

const encodeJwtPart = (value: unknown) =>
	btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const idToken = (nonce: string) => {
	return `${encodeJwtPart({ alg: "none" })}.${encodeJwtPart({ nonce })}.signature`;
};

const jsonResponse = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const requestUrl = (input: Parameters<typeof fetch>[0]) => {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.toString() : input.url;
};

const tokenResponse = (overrides: Record<string, unknown> = {}) => ({
	expires_in: 900,
	token_type: "Bearer",
	access_token: "access-1",
	refresh_token: "refresh-1",
	expires_at: now / 1000 + 900,
	id_token: idToken("nonce-1"),
	scope: "openid profile email offline_access ryot:api",
	...overrides,
});

type EndpointRequest = { readonly url: string; readonly body: string };

class FakeOAuthEndpoint extends Context.Service<
	FakeOAuthEndpoint,
	{
		readonly requests: Effect.Effect<ReadonlyArray<EndpointRequest>>;
		readonly release: Effect.Effect<void>;
	}
>()("test/FakeOAuthEndpoint") {}

const tokenLayer = (
	reply: (request: number) => Effect.Effect<Response>,
	options: { readonly held?: boolean; readonly storage?: Partial<OAuthStorageAdapter> } = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const requests = yield* Ref.make<ReadonlyArray<EndpointRequest>>([]);
			const gate = yield* Deferred.make<void>();
			if (!options.held) {
				yield* Deferred.succeed(gate, undefined);
			}
			const context = yield* Effect.context();
			const fetcher: typeof fetch = (input, init) =>
				Effect.runPromiseWith(context)(
					Effect.gen(function* () {
						const body = init?.body instanceof URLSearchParams ? init.body.toString() : "";
						const recorded = yield* Ref.updateAndGet(requests, (all) => [
							...all,
							{ body, url: requestUrl(input) },
						]);
						yield* Deferred.await(gate);
						return yield* reply(recorded.length);
					}),
				);
			return Layer.merge(
				oauthTokenServiceLayer(fetcher, () => now),
				Layer.succeed(FakeOAuthEndpoint, {
					requests: Ref.get(requests),
					release: Deferred.succeed(gate, undefined).pipe(Effect.asVoid),
				}),
			);
		}),
	).pipe(Layer.provideMerge(fakeOAuthStorageLayer(options.storage)));

const respond = (value: unknown, status?: number) => () =>
	Effect.sync(() => jsonResponse(value, status));

const emptyResponse = () => Effect.sync(() => new Response(null, { status: 200 }));

const networkDown = () => Effect.die(new TypeError("network down"));

const pending = () =>
	({
		createdAt: now,
		state: "state-1",
		nonce: "nonce-1",
		destination: "/settings",
		codeVerifier: "verifier-1",
		clientId: OAUTH_WEB_CLIENT_ID,
		serverOrigin: "https://ryot.example",
		redirectUri: `${origin}/auth/callback`,
	}) as const;

const tokenSet = (overrides: Partial<StoredTokenSet> = {}): StoredTokenSet => ({
	tokenType: "Bearer",
	accessToken: "expired",
	scope: "openid ryot:api",
	refreshToken: "refresh-1",
	accessTokenExpiresAt: now,
	idToken: idToken("nonce-1"),
	clientId: OAUTH_WEB_CLIENT_ID,
	...overrides,
});

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

describe("OAuth token service", () => {
	layer(tokenLayer(respond(tokenResponse())))((test) => {
		test.effect("exchanges a code with PKCE, validates nonce, and stores the token set", () =>
			Effect.gen(function* () {
				const persisted = yield* OAuthStorage;
				yield* persisted.setPending(pending());
				const tokens = yield* OAuthTokenService;
				expect(
					yield* tokens.completeAuthorization(
						origin,
						[OAUTH_WEB_CLIENT_ID],
						`${origin}/auth/callback`,
						"state-1",
						"code-1",
					),
				).toEqual(pending());

				const requests = yield* (yield* FakeOAuthEndpoint).requests;
				expect(requests[0]?.url).toBe(`${origin}/api/auth/oauth2/token`);
				expect(Object.fromEntries(new URLSearchParams(requests[0]?.body))).toMatchObject({
					code: "code-1",
					client_id: "ryot-web",
					code_verifier: "verifier-1",
					grant_type: "authorization_code",
					redirect_uri: `${origin}/auth/callback`,
				});
				expect(yield* persisted.getTokenSet(origin)).toEqual({
					tokenType: "Bearer",
					accessToken: "access-1",
					refreshToken: "refresh-1",
					idToken: idToken("nonce-1"),
					clientId: OAUTH_WEB_CLIENT_ID,
					accessTokenExpiresAt: now + 900_000,
					scope: "openid profile email offline_access ryot:api",
				});
				expect(yield* persisted.takePending(origin, "state-1")).toBeNull();
			}),
		);
	});

	layer(tokenLayer(respond(tokenResponse())))((test) => {
		test.effect("accepts a demo web authorization and preserves its issuing client", () =>
			Effect.gen(function* () {
				const persisted = yield* OAuthStorage;
				yield* persisted.setPending({ ...pending(), clientId: OAUTH_DEMO_WEB_CLIENT_ID });
				const tokens = yield* OAuthTokenService;

				yield* tokens.completeAuthorization(
					origin,
					[OAUTH_WEB_CLIENT_ID, OAUTH_DEMO_WEB_CLIENT_ID],
					`${origin}/auth/callback`,
					"state-1",
					"code-1",
				);

				expect((yield* persisted.getTokenSet(origin))?.clientId).toBe(OAUTH_DEMO_WEB_CLIENT_ID);
			}),
		);
	});

	layer(tokenLayer(respond(tokenResponse())))((test) => {
		test.effect("rejects a pending native client on a web callback", () =>
			Effect.gen(function* () {
				const persisted = yield* OAuthStorage;
				yield* persisted.setPending({ ...pending(), clientId: "ryot-native" });
				const tokens = yield* OAuthTokenService;
				const failure = yield* Effect.flip(
					tokens.completeAuthorization(
						origin,
						[OAUTH_WEB_CLIENT_ID, OAUTH_DEMO_WEB_CLIENT_ID],
						`${origin}/auth/callback`,
						"state-1",
						"code-1",
					),
				);

				expect(failure.reason).toBe("invalid-callback");
				expect(yield* (yield* FakeOAuthEndpoint).requests).toHaveLength(0);
				expect(yield* persisted.getPending(origin, "state-1")).toBeNull();
			}),
		);
	});

	layer(tokenLayer(respond(tokenResponse({ id_token: idToken("wrong") }))))((test) => {
		test.effect("rejects an ID token nonce mismatch and consumes the state", () =>
			Effect.gen(function* () {
				const persisted = yield* OAuthStorage;
				yield* persisted.setPending(pending());
				const tokens = yield* OAuthTokenService;
				const result = yield* Effect.exit(
					tokens.completeAuthorization(
						origin,
						[OAUTH_WEB_CLIENT_ID],
						`${origin}/auth/callback`,
						"state-1",
						"code-1",
					),
				);
				expect(result._tag).toBe("Failure");
				expect(yield* persisted.takePending(origin, "state-1")).toBeNull();
			}),
		);
	});

	layer(
		tokenLayer((request) =>
			request === 1 ? networkDown() : Effect.sync(() => jsonResponse(tokenResponse())),
		),
	)((test) => {
		test.effect("retries a code exchange after a transport failure with the same state", () =>
			Effect.gen(function* () {
				const persisted = yield* OAuthStorage;
				const storage = yield* FakeOAuthStorage;
				yield* persisted.setPending(pending());
				const tokens = yield* OAuthTokenService;

				const failure = yield* Effect.flip(
					tokens.completeAuthorization(
						origin,
						[OAUTH_WEB_CLIENT_ID],
						`${origin}/auth/callback`,
						"state-1",
						"code-1",
					),
				);
				expect(failure.reason).toBe("request-failed");
				expect((yield* storage.values).has(oauthPendingKey(origin, "state-1"))).toBe(true);

				expect(
					yield* tokens.completeAuthorization(
						origin,
						[OAUTH_WEB_CLIENT_ID],
						`${origin}/auth/callback`,
						"state-1",
						"code-1",
					),
				).toEqual(pending());
				expect(yield* (yield* FakeOAuthEndpoint).requests).toHaveLength(2);
				expect((yield* storage.values).has(oauthPendingKey(origin, "state-1"))).toBe(false);
			}),
		);
	});

	layer(tokenLayer(respond({ error: "invalid_grant" }, 400)))((test) => {
		test.effect("consumes the state after a terminal token endpoint failure", () =>
			Effect.gen(function* () {
				const persisted = yield* OAuthStorage;
				yield* persisted.setPending(pending());
				const tokens = yield* OAuthTokenService;
				const failure = yield* Effect.flip(
					tokens.completeAuthorization(
						origin,
						[OAUTH_WEB_CLIENT_ID],
						`${origin}/auth/callback`,
						"state-1",
						"code-1",
					),
				);
				expect(failure.reason).toBe("request-failed");
				expect(
					(yield* (yield* FakeOAuthStorage).values).has(oauthPendingKey(origin, "state-1")),
				).toBe(false);
			}),
		);
	});

	layer(
		tokenLayer(respond(tokenResponse({ access_token: "access-2", refresh_token: "refresh-2" }))),
	)((test) => {
		test.effect("refreshes with each stored web client and keeps one request in flight", () =>
			Effect.gen(function* () {
				const persisted = yield* OAuthStorage;
				yield* persisted.setTokenSet(origin, tokenSet());
				const tokens = yield* OAuthTokenService;
				expect(yield* tokens.accessToken(origin)).toBe("access-2");
				yield* persisted.setTokenSet(origin, tokenSet({ clientId: OAUTH_DEMO_WEB_CLIENT_ID }));
				expect(
					yield* Effect.all([tokens.accessToken(origin), tokens.accessToken(origin)], {
						concurrency: "unbounded",
					}),
				).toEqual(["access-2", "access-2"]);
				const requests = yield* (yield* FakeOAuthEndpoint).requests;
				expect(requests).toHaveLength(2);
				expect(requests.map(({ body }) => new URLSearchParams(body).get("client_id"))).toEqual([
					OAUTH_WEB_CLIENT_ID,
					OAUTH_DEMO_WEB_CLIENT_ID,
				]);
				expect((yield* persisted.getTokenSet(origin))?.refreshToken).toBe("refresh-2");
			}),
		);
	});

	layer(tokenLayer(respond({ error: "invalid_grant", error_description: "expired" }, 400)))(
		(test) => {
			test.effect("clears authentication when refresh returns invalid_grant", () =>
				Effect.gen(function* () {
					const persisted = yield* OAuthStorage;
					yield* persisted.setTokenSet(origin, tokenSet({ refreshToken: "invalid" }));
					const tokens = yield* OAuthTokenService;
					yield* Effect.exit(tokens.accessToken(origin));
					expect(yield* persisted.getTokenSet(origin)).toBeNull();
				}),
			);
		},
	);

	layer(tokenLayer(emptyResponse))((test) => {
		test.effect(
			"revokes both tokens, clears local state, and builds an exact end-session callback",
			() =>
				Effect.gen(function* () {
					const persisted = yield* OAuthStorage;
					yield* persisted.setTokenSet(
						origin,
						tokenSet({ accessToken: "access-1", clientId: OAUTH_DEMO_WEB_CLIENT_ID }),
					);
					yield* persisted.setPending(pending());
					const tokens = yield* OAuthTokenService;
					const endSession = yield* tokens.logout(origin, `${origin}/auth/logout/callback`);

					const requests = yield* (yield* FakeOAuthEndpoint).requests;
					expect(requests).toHaveLength(2);
					expect(requests.every(({ url }) => url === `${origin}/api/auth/oauth2/revoke`)).toBe(
						true,
					);
					expect(requests.map(({ body }) => Object.fromEntries(new URLSearchParams(body)))).toEqual(
						[
							{
								token: "refresh-1",
								token_type_hint: "refresh_token",
								client_id: OAUTH_DEMO_WEB_CLIENT_ID,
							},
							{
								token: "access-1",
								token_type_hint: "access_token",
								client_id: OAUTH_DEMO_WEB_CLIENT_ID,
							},
						],
					);
					expect(new URL(endSession ?? "").searchParams.get("post_logout_redirect_uri")).toBe(
						`${origin}/auth/logout/callback`,
					);
					expect(yield* persisted.getTokenSet(origin)).toBeNull();
					expect(yield* persisted.takePending(origin, "state-1")).toBeNull();
				}),
		);
	});

	layer(tokenLayer(emptyResponse))((test) => {
		test.effect("keeps impersonation tokens until the logout callback and marks its state", () =>
			Effect.gen(function* () {
				const persisted = yield* OAuthStorage;
				const current = tokenSet({
					accessToken: "impersonation-access",
					refreshToken: "impersonation-refresh",
					clientId: OAUTH_IMPERSONATION_WEB_CLIENT_ID,
				});
				yield* persisted.setTokenSet(origin, current);
				yield* persisted.setPending(pending());
				const tokens = yield* OAuthTokenService;
				const endSession = yield* tokens.logout(origin, `${origin}/auth/logout/callback`);

				expect(new URL(endSession ?? "").searchParams.get("state")).toBe("impersonation");
				expect(yield* (yield* FakeOAuthEndpoint).requests).toEqual([]);
				expect(yield* persisted.getTokenSet(origin)).toEqual(current);
				expect(yield* persisted.getPending(origin, "state-1")).toEqual(pending());
			}),
		);
	});

	layer(
		tokenLayer(emptyResponse, {
			storage: { removeItem: () => Effect.fail(new OAuthStorageError({ reason: "write-failed" })) },
		}),
	)((test) => {
		test.effect("fails explicit logout when local token deletion fails", () =>
			Effect.gen(function* () {
				const storage = yield* FakeOAuthStorage;
				yield* storage.seed(
					oauthTokenKey(origin),
					yield* encodeJson(tokenSet({ accessToken: "access-1" })),
				);
				const tokens = yield* OAuthTokenService;
				const failure = yield* Effect.flip(tokens.logout(origin, `${origin}/auth/logout/callback`));
				expect(failure.reason).toBe("storage-failed");
				expect((yield* storage.values).has(oauthTokenKey(origin))).toBe(true);
			}),
		);
	});

	layer(tokenLayer(networkDown))((test) => {
		test.effect("deletes local authentication when remote revocation fails", () =>
			Effect.gen(function* () {
				const persisted = yield* OAuthStorage;
				const storage = yield* FakeOAuthStorage;
				yield* persisted.setTokenSet(origin, tokenSet({ accessToken: "access-1" }));
				yield* persisted.setPending(pending());
				const tokens = yield* OAuthTokenService;
				const endSession = yield* tokens.logout(origin, `${origin}/auth/logout/callback`);

				expect(yield* (yield* FakeOAuthEndpoint).requests).toHaveLength(2);
				expect(endSession).not.toBeNull();
				expect((yield* storage.values).has(oauthTokenKey(origin))).toBe(false);
				expect((yield* storage.values).has(oauthPendingKey(origin, "state-1"))).toBe(false);
			}),
		);
	});

	layer(
		tokenLayer(respond(tokenResponse({ access_token: "access-2", refresh_token: "refresh-2" })), {
			storage: { setItem: () => Effect.fail(new OAuthStorageError({ reason: "write-failed" })) },
		}),
	)((test) => {
		test.effect("drops the stored token set when persisting a rotated refresh token fails", () =>
			Effect.gen(function* () {
				const storage = yield* FakeOAuthStorage;
				yield* storage.seed(oauthTokenKey(origin), yield* encodeJson(tokenSet()));
				const tokens = yield* OAuthTokenService;
				const failure = yield* Effect.flip(tokens.accessToken(origin));
				expect(failure.reason).toBe("storage-failed");
				expect((yield* storage.values).has(oauthTokenKey(origin))).toBe(false);
			}),
		);
	});

	layer(
		tokenLayer(respond(tokenResponse({ access_token: "access-2", refresh_token: "refresh-2" })), {
			held: true,
		}),
	)((test) => {
		test.effect("finishes a refresh started by a caller that is later interrupted", () =>
			Effect.gen(function* () {
				const persisted = yield* OAuthStorage;
				const endpoint = yield* FakeOAuthEndpoint;
				yield* persisted.setTokenSet(origin, tokenSet());
				const tokens = yield* OAuthTokenService;
				const abandoned = yield* Effect.forkChild(tokens.accessToken(origin), {
					startImmediately: true,
				});
				const surviving = yield* Effect.forkChild(tokens.accessToken(origin), {
					startImmediately: true,
				});

				yield* Fiber.interrupt(abandoned);
				yield* endpoint.release;
				expect(yield* Fiber.join(surviving)).toBe("access-2");
				expect(yield* endpoint.requests).toHaveLength(1);
				expect((yield* persisted.getTokenSet(origin))?.refreshToken).toBe("refresh-2");
			}),
		);
	});

	layer(tokenLayer(networkDown))((test) => {
		test.effect("keeps the stored token set when a refresh fails to reach the server", () =>
			Effect.gen(function* () {
				const storage = yield* FakeOAuthStorage;
				yield* storage.seed(oauthTokenKey(origin), yield* encodeJson(tokenSet()));
				const tokens = yield* OAuthTokenService;
				const failure = yield* Effect.flip(tokens.accessToken(origin));
				expect(failure.reason).toBe("request-failed");
				expect((yield* storage.values).has(oauthTokenKey(origin))).toBe(true);
			}),
		);
	});
});
