import { describe, expect, it } from "@effect/vitest";
import { OAUTH_WEB_CLIENT_ID } from "@ryot/contract/oauth";
import { Effect } from "effect";

import { OAuthStorage, oauthStorageLayer } from "#/modules/auth/oauth-storage";
import { OAuthTokenService, oauthTokenServiceLayer } from "#/modules/auth/token-service";

const origin = "https://ryot.example";
const now = 1_800_000_000_000;

const encodeJwtPart = (value: unknown) =>
	btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const idToken = (nonce: string) => {
	return `${encodeJwtPart({ alg: "none" })}.${encodeJwtPart({ nonce })}.signature`;
};

const jsonResponse = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});

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

const makeStorage = () => {
	const values = new Map<string, string>();
	return {
		values,
		layer: oauthStorageLayer({
			removeItem: (key) => values.delete(key),
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, value),
		}),
	};
};

const pending = () =>
	({
		createdAt: now,
		state: "state-1",
		nonce: "nonce-1",
		serverOrigin: origin,
		destination: "/settings",
		codeVerifier: "verifier-1",
		clientId: OAUTH_WEB_CLIENT_ID,
		redirectUri: `${origin}/auth/callback`,
	}) as const;

describe("OAuth token service", () => {
	it.effect("exchanges a code with PKCE, validates nonce, and stores the token set", () => {
		const storage = makeStorage();
		const requests: Array<{ readonly url: string; readonly body: string }> = [];
		const fetcher: typeof fetch = (input, init) => {
			const body = init?.body instanceof URLSearchParams ? init.body.toString() : "";
			requests.push({ body, url: requestUrl(input) });
			return Promise.resolve(jsonResponse(tokenResponse()));
		};
		return Effect.gen(function* () {
			const persisted = yield* OAuthStorage;
			yield* persisted.setPending(pending());
			const tokens = yield* OAuthTokenService;
			expect(
				yield* tokens.completeAuthorization(
					origin,
					OAUTH_WEB_CLIENT_ID,
					`${origin}/auth/callback`,
					"state-1",
					"code-1",
				),
			).toEqual(pending());

			expect(requests[0]?.url).toBe(`${origin}/api/auth/oauth2/token`);
			expect(Object.fromEntries(new URLSearchParams(requests[0]?.body))).toMatchObject({
				code: "code-1",
				client_id: "ryot-web",
				code_verifier: "verifier-1",
				grant_type: "authorization_code",
				redirect_uri: `${origin}/auth/callback`,
			});
			expect(yield* persisted.getTokenSet(origin)).toEqual({
				scope: "openid profile email offline_access ryot:api",
				tokenType: "Bearer",
				accessToken: "access-1",
				refreshToken: "refresh-1",
				idToken: idToken("nonce-1"),
				accessTokenExpiresAt: now + 900_000,
			});
			expect(yield* persisted.getPending(origin, "state-1")).toBeNull();
		}).pipe(
			Effect.provide(oauthTokenServiceLayer(fetcher, () => now)),
			Effect.provide(storage.layer),
		);
	});

	it.effect("rejects an ID token nonce mismatch and consumes the state", () => {
		const storage = makeStorage();
		return Effect.gen(function* () {
			const persisted = yield* OAuthStorage;
			yield* persisted.setPending(pending());
			const tokens = yield* OAuthTokenService;
			const result = yield* Effect.exit(
				tokens.completeAuthorization(
					origin,
					OAUTH_WEB_CLIENT_ID,
					`${origin}/auth/callback`,
					"state-1",
					"code-1",
				),
			);
			expect(result._tag).toBe("Failure");
			expect(yield* persisted.getPending(origin, "state-1")).toBeNull();
		}).pipe(
			Effect.provide(
				oauthTokenServiceLayer(
					() => Promise.resolve(jsonResponse(tokenResponse({ id_token: idToken("wrong") }))),
					() => now,
				),
			),
			Effect.provide(storage.layer),
		);
	});

	it.effect("rotates refresh tokens with one refresh request in flight per server", () => {
		const storage = makeStorage();
		let requests = 0;
		return Effect.gen(function* () {
			const persisted = yield* OAuthStorage;
			yield* persisted.setTokenSet(origin, {
				tokenType: "Bearer",
				accessToken: "expired",
				scope: "openid ryot:api",
				refreshToken: "refresh-1",
				accessTokenExpiresAt: now,
				idToken: idToken("nonce-1"),
			});
			const tokens = yield* OAuthTokenService;
			expect(
				yield* Effect.all(
					[
						tokens.accessToken(origin, OAUTH_WEB_CLIENT_ID),
						tokens.accessToken(origin, OAUTH_WEB_CLIENT_ID),
					],
					{ concurrency: "unbounded" },
				),
			).toEqual(["access-2", "access-2"]);
			expect(requests).toBe(1);
			expect((yield* persisted.getTokenSet(origin))?.refreshToken).toBe("refresh-2");
		}).pipe(
			Effect.provide(
				oauthTokenServiceLayer(
					() => {
						requests += 1;
						return Promise.resolve(
							jsonResponse(tokenResponse({ access_token: "access-2", refresh_token: "refresh-2" })),
						);
					},
					() => now,
				),
			),
			Effect.provide(storage.layer),
		);
	});

	it.effect("clears authentication when refresh returns invalid_grant", () => {
		const storage = makeStorage();
		return Effect.gen(function* () {
			const persisted = yield* OAuthStorage;
			yield* persisted.setTokenSet(origin, {
				tokenType: "Bearer",
				accessToken: "expired",
				refreshToken: "invalid",
				scope: "openid ryot:api",
				accessTokenExpiresAt: now,
				idToken: idToken("nonce-1"),
			});
			const tokens = yield* OAuthTokenService;
			yield* Effect.exit(tokens.accessToken(origin, OAUTH_WEB_CLIENT_ID));
			expect(yield* persisted.getTokenSet(origin)).toBeNull();
		}).pipe(
			Effect.provide(
				oauthTokenServiceLayer(
					() =>
						Promise.resolve(
							jsonResponse({ error: "invalid_grant", error_description: "expired" }, 400),
						),
					() => now,
				),
			),
			Effect.provide(storage.layer),
		);
	});
});
