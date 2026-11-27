import { expect } from "bun:test";

import { oauthProvider } from "@better-auth/oauth-provider";
import {
	buildOAuthAuthorizationUrl,
	getOAuthResource,
	OAUTH_NATIVE_CALLBACK_URIS,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_WEB_CLIENT_ID,
	OAUTH_WEB_CLIENT_IDS,
} from "@ryot-app/contract/oauth";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { applySetCookies } from "better-auth/cookies";
import { jwt } from "better-auth/plugins";
import { Effect, Schema } from "effect";

import { allowFrontendHttpRedirectUri, internalOAuthRecords } from "./oauth-provisioning";

const origin = "http://192.168.1.50:8000";
const callback = `${origin}/auth/callback`;
const verifier = "a-pkce-verifier-with-at-least-forty-three-characters";
const Redirect = Schema.Struct({ url: Schema.String, redirect: Schema.Literal(true) });
const Tokens = Schema.Struct({ id_token: Schema.String, access_token: Schema.String });

const makeAuth = () => {
	const records = internalOAuthRecords(origin, new Date(), true);
	const { endpoints, ...plugin } = oauthProvider({
		loginPage: "/oauth/login",
		consentPage: "/oauth/consent",
		enforcePerClientResources: true,
		resources: [getOAuthResource(origin)],
		allowDynamicClientRegistration: false,
		allowInsecureRedirectUri: allowFrontendHttpRedirectUri(origin),
	});
	const provider: BetterAuthPlugin = plugin;
	Object.assign(provider, { endpoints });
	return betterAuth({
		baseURL: origin,
		trustedOrigins: [origin],
		plugins: [jwt(), provider],
		rateLimit: { enabled: false },
		emailAndPassword: { enabled: true },
		secret: "http-oauth-test-secret-with-at-least-32-characters",
		database: memoryAdapter({
			user: [],
			jwks: [],
			session: [],
			account: [],
			verification: [],
			oauthConsent: [],
			oauthAccessToken: [],
			oauthRefreshToken: [],
			oauthClient: [...records.clients],
			oauthResource: [records.resource],
			oauthClientResource: records.links,
		}),
	});
};

it.effect(
	"completes signed HTTP login, code exchange, and confirmed logout",
	() =>
		Effect.gen(function* () {
			const auth = makeAuth();
			const handler = auth.handler;
			const challenge = yield* Effect.promise(() =>
				crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
			);
			const authorize = buildOAuthAuthorizationUrl(origin, {
				state: "login-state",
				nonce: "login-nonce",
				redirectUri: callback,
				clientId: OAUTH_WEB_CLIENT_ID,
				codeChallenge: Buffer.from(challenge).toString("base64url"),
			});
			const first = yield* Effect.promise(() => handler(new Request(authorize)));
			expect(first.status).toBe(302);
			const location = first.headers.get("location");
			assert(location !== null);
			const login = new URL(location, origin);
			expect(login.pathname).toBe("/oauth/login");
			expect(login.searchParams.get("redirect_uri")).toBe(callback);
			expect(login.searchParams.get("sig")).toBeTruthy();

			const signupBody = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
				name: "User",
				email: "user@example.com",
				password: "test-password-123",
				oauth_query: login.search.slice(1),
			});
			const signup = yield* Effect.promise(() =>
				handler(
					new Request(`${origin}/api/auth/sign-up/email`, {
						method: "POST",
						body: signupBody,
						headers: { origin, accept: "application/json", "content-type": "application/json" },
					}),
				),
			);
			expect(signup.status).toBe(200);
			const signedIn = yield* Schema.decodeUnknownEffect(Redirect)(
				yield* Effect.promise(() => signup.json()),
			);
			const finalCallback = new URL(signedIn.url);
			expect(finalCallback.origin + finalCallback.pathname).toBe(callback);
			expect(finalCallback.searchParams.get("state")).toBe("login-state");
			const code = finalCallback.searchParams.get("code");
			assert(code !== null);
			const cookies = new Headers({ origin });
			applySetCookies(cookies, signup.headers.getSetCookie());
			expect(cookies.get("cookie")).toContain("better-auth.session_token");

			const tokenResponse = yield* Effect.promise(() =>
				handler(
					new Request(`${origin}/api/auth/oauth2/token`, {
						method: "POST",
						headers: { "content-type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams({
							code,
							redirect_uri: callback,
							code_verifier: verifier,
							client_id: OAUTH_WEB_CLIENT_ID,
							grant_type: "authorization_code",
							resource: getOAuthResource(origin),
						}),
					}),
				),
			);
			expect(tokenResponse.status).toBe(200);
			const tokens = yield* Schema.decodeUnknownEffect(Tokens)(
				yield* Effect.promise(() => tokenResponse.json()),
			);
			expect(tokens.access_token).toBeTruthy();

			for (const clientId of [...OAUTH_WEB_CLIENT_IDS, OAUTH_NATIVE_CLIENT_ID]) {
				const redirectUri =
					clientId === OAUTH_NATIVE_CLIENT_ID ? OAUTH_NATIVE_CALLBACK_URIS[0] : callback;
				assert(redirectUri !== undefined);
				const url = new URL(authorize);
				url.searchParams.set("client_id", clientId);
				url.searchParams.set("redirect_uri", redirectUri);
				const response = yield* Effect.promise(() =>
					handler(new Request(url.toString(), { headers: cookies })),
				);
				expect(response.status).toBe(302);
				const target = response.headers.get("location");
				assert(target !== null);
				expect(target.startsWith(`${redirectUri}?`)).toBe(true);
				expect(new URL(target).searchParams.get("code")).toBeTruthy();
			}

			const logout = new URL(`${origin}/api/auth/oauth2/end-session`);
			logout.search = new URLSearchParams({
				state: "logout-state",
				client_id: OAUTH_WEB_CLIENT_ID,
				post_logout_redirect_uri: `${origin}/auth/logout/callback`,
			}).toString();
			const navigation = new Headers(cookies);
			navigation.set("accept", "text/html");
			const confirmation = yield* Effect.promise(() =>
				handler(new Request(logout.toString(), { headers: navigation })),
			);
			expect(confirmation.status).toBe(200);
			applySetCookies(navigation, confirmation.headers.getSetCookie());
			navigation.set("content-type", "application/x-www-form-urlencoded");
			const loggedOut = yield* Effect.promise(() =>
				handler(
					new Request(`${origin}/api/auth/oauth2/end-session/confirm`, {
						method: "POST",
						headers: navigation,
						body: "action=confirm",
					}),
				),
			);
			expect(loggedOut.status).toBe(302);
			expect(loggedOut.headers.get("location")).toBe(
				`${origin}/auth/logout/callback?state=logout-state`,
			);
		}),
	testTimeout,
);
