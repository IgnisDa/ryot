import {
	getOAuthEndpoint,
	getOAuthResource,
	OAUTH_NATIVE_CALLBACK_URIS,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_TOKEN_PATH,
	OAUTH_WEB_CLIENT_ID,
} from "@ryot/contract/oauth";
import { Effect } from "effect";

import { createTestUser, prepareOAuth, type PendingOAuth } from "~/fixtures/kernel";
import { getApiUrl } from "~/support/api";
import { requirePresent } from "~/support/assertions";
import { beforeAll, describe, expect, it } from "~/support/effect-test";

const OAUTH_REGISTER_PATH = "/api/auth/oauth2/register";

let sessionCookie: string;

const callbackFrom = (response: Response, pending: PendingOAuth) =>
	new URL(
		requirePresent(response.headers.get("location"), "OAuth authorization did not redirect"),
		pending.serverOrigin,
	);

const authorize = async (cookie: string, configure?: (authorizationUrl: URL) => void) => {
	const pending = await prepareOAuth(getApiUrl());
	const authorizationUrl = new URL(pending.authorizationUrl);
	configure?.(authorizationUrl);
	const response = await fetch(authorizationUrl, {
		redirect: "manual",
		headers: { Cookie: cookie },
	});
	return { pending, response, callback: callbackFrom(response, pending) };
};

const exchangeCode = (pending: PendingOAuth, code: string, codeVerifier: string) =>
	fetch(getOAuthEndpoint(pending.serverOrigin, OAUTH_TOKEN_PATH), {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			code_verifier: codeVerifier,
			client_id: OAUTH_WEB_CLIENT_ID,
			grant_type: "authorization_code",
			redirect_uri: pending.redirectUri,
			resource: getOAuthResource(pending.frontendOrigin),
		}),
	});

beforeAll(async () => {
	const user = await Effect.runPromise(createTestUser());
	sessionCookie = user.sessionCookie;
});

describe("OAuth protocol enforcement", () => {
	it.live("rejects authorization without a PKCE challenge", () =>
		Effect.gen(function* () {
			const pending = yield* Effect.promise(() => prepareOAuth(getApiUrl()));
			const authorizationUrl = new URL(pending.authorizationUrl);
			authorizationUrl.searchParams.delete("code_challenge");
			authorizationUrl.searchParams.delete("code_challenge_method");

			const response = yield* Effect.promise(() => fetch(authorizationUrl, { redirect: "manual" }));
			const callback = callbackFrom(response, pending);

			expect(response.status).toBe(302);
			expect(callback.origin).toBe(new URL(pending.redirectUri).origin);
			expect(callback.searchParams.get("error")).toBe("invalid_request");
			expect(callback.searchParams.get("error_description")).toBe(
				"pkce is required for public clients",
			);
		}),
	);

	it.live("rejects an unregistered redirect URI", () =>
		Effect.gen(function* () {
			const unregisteredRedirectUri = "https://unregistered.example/auth/callback";
			const pending = yield* Effect.promise(() => prepareOAuth(getApiUrl()));
			const authorizationUrl = new URL(pending.authorizationUrl);
			authorizationUrl.searchParams.set("redirect_uri", unregisteredRedirectUri);

			const response = yield* Effect.promise(() => fetch(authorizationUrl, { redirect: "manual" }));
			const callback = callbackFrom(response, pending);

			expect(response.status).toBe(302);
			expect(callback.origin).not.toBe(new URL(unregisteredRedirectUri).origin);
			expect(callback.searchParams.get("error")).toBe("invalid_redirect");
			expect(callback.searchParams.get("error_description")).toBe("invalid redirect uri");
		}),
	);

	it.live("accepts both registered native callback URIs", () =>
		Effect.gen(function* () {
			for (const redirectUri of OAUTH_NATIVE_CALLBACK_URIS) {
				const { callback, response } = yield* Effect.promise(() =>
					authorize(sessionCookie, (authorizationUrl) => {
						authorizationUrl.searchParams.set("client_id", OAUTH_NATIVE_CLIENT_ID);
						authorizationUrl.searchParams.set("redirect_uri", redirectUri);
					}),
				);

				expect(response.status).toBe(302);
				expect(`${callback.protocol}${callback.pathname}`).toBe(redirectUri);
				expect(callback.searchParams.get("code")).toBeTruthy();
				expect(callback.searchParams.get("error")).toBeNull();
			}
		}),
	);

	it.live("rejects a valid code exchanged with the wrong verifier", () =>
		Effect.gen(function* () {
			const { callback, pending } = yield* Effect.promise(() => authorize(sessionCookie));
			const code = requirePresent(
				callback.searchParams.get("code"),
				"OAuth authorization did not return a code",
			);

			const response = yield* Effect.promise(() =>
				exchangeCode(pending, code, crypto.randomUUID()),
			);

			expect(response.status).toBe(401);
			expect(yield* Effect.promise(() => response.json())).toMatchObject({
				error: "invalid_request",
				error_description: "code verification failed",
			});
		}),
	);

	it.live("rejects replay of a successfully exchanged authorization code", () =>
		Effect.gen(function* () {
			const { callback, pending } = yield* Effect.promise(() => authorize(sessionCookie));
			const code = requirePresent(
				callback.searchParams.get("code"),
				"OAuth authorization did not return a code",
			);

			const firstResponse = yield* Effect.promise(() =>
				exchangeCode(pending, code, pending.codeVerifier),
			);
			const replayResponse = yield* Effect.promise(() =>
				exchangeCode(pending, code, pending.codeVerifier),
			);

			expect(firstResponse.status).toBe(200);
			expect(replayResponse.status).toBe(400);
			expect(yield* Effect.promise(() => replayResponse.json())).toMatchObject({
				error: "invalid_grant",
				error_description: "invalid code",
			});
		}),
	);

	it.live("does not advertise or permit dynamic registration", () =>
		Effect.gen(function* () {
			const apiUrl = getApiUrl();
			const discoveryResponse = yield* Effect.promise(() =>
				fetch(`${apiUrl}/auth/.well-known/openid-configuration`),
			);
			const discovery: unknown = yield* Effect.promise(() => discoveryResponse.json());

			expect(discoveryResponse.status).toBe(200);
			expect(discovery).not.toHaveProperty("registration_endpoint");

			const registrationResponse = yield* Effect.promise(() =>
				fetch(getOAuthEndpoint(new URL(apiUrl).origin, OAUTH_REGISTER_PATH), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ redirect_uris: ["https://client.example/callback"] }),
				}),
			);
			expect(registrationResponse.status).toBe(403);
			expect(yield* Effect.promise(() => registrationResponse.json())).toMatchObject({
				error: "access_denied",
				error_description: "Client registration is disabled",
			});
		}),
	);
});
