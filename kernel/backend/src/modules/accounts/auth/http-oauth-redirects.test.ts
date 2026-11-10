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

import { makeHttpOAuthRedirects } from "./http-oauth-redirects";
import { internalOAuthRecords } from "./oauth-provisioning";

const origin = "http://192.168.1.50:8000";
const callback = `${origin}/auth/callback`;
const internalCallback = "https://192.168.1.50:8000/auth/callback";
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
			const handler = makeHttpOAuthRedirects(origin).wrapHandler(auth.handler);
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
			expect(login.searchParams.get("redirect_uri")).toBe(internalCallback);
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

it.effect(
	"translates JSON token and form logout bodies without changing signed parameters or headers",
	() =>
		Effect.gen(function* () {
			const requests: Request[] = [];
			const handler = makeHttpOAuthRedirects(origin).wrapHandler((request) => {
				requests.push(request);
				return Promise.resolve(
					Response.json(
						{ redirect: true, url: `${internalCallback}?code=abc%2Bdef#fragment` },
						{
							headers: [
								["set-cookie", "one=1; HttpOnly"],
								["set-cookie", "two=2; HttpOnly"],
								["cache-control", "no-store"],
							],
						},
					),
				);
			});
			const body = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
				redirect_uri: callback,
				resource: `${origin}/api`,
				oauth_query: `redirect_uri=${callback}&sig=untouched`,
			});
			const response = yield* Effect.promise(() =>
				handler(
					new Request(`${origin}/api/auth/oauth2/token`, {
						body,
						method: "POST",
						headers: {
							origin,
							"content-type": "application/json",
							"content-length": String(body.length),
						},
					}),
				),
			);
			const tokenRequest = requests[0];
			assert(tokenRequest !== undefined);
			expect(yield* Effect.promise(() => tokenRequest.json())).toEqual({
				resource: `${origin}/api`,
				redirect_uri: internalCallback,
				oauth_query: `redirect_uri=${callback}&sig=untouched`,
			});
			expect(tokenRequest.headers.get("origin")).toBe(origin);
			expect(tokenRequest.headers.get("content-length")).toBeNull();
			expect(yield* Effect.promise(() => response.json())).toEqual({
				redirect: true,
				url: `${callback}?code=abc%2Bdef#fragment`,
			});
			expect(response.headers.getSetCookie()).toEqual(["one=1; HttpOnly", "two=2; HttpOnly"]);
			expect(response.headers.get("cache-control")).toBe("no-store");

			yield* Effect.promise(() =>
				handler(
					new Request(`${origin}/api/auth/oauth2/end-session`, {
						method: "POST",
						headers: { "content-type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams({
							state: "logout",
							post_logout_redirect_uri: `${origin}/auth/logout/callback`,
						}),
					}),
				),
			);
			const request = requests[1];
			assert(request !== undefined);
			expect(
				new URLSearchParams(yield* Effect.promise(() => request.text())).get(
					"post_logout_redirect_uri",
				),
			).toBe("https://192.168.1.50:8000/auth/logout/callback");
		}),
	testTimeout,
);

it.effect(
	"leaves unrelated destinations and signed login redirects untouched",
	() =>
		Effect.gen(function* () {
			for (const destination of [
				"http://other.example/auth/callback",
				`${origin}/other`,
				`${origin}/auth/callback/extra`,
				`${origin}/auth/callback?extra=1`,
				"io.ryot.app:/auth/callback",
				`/oauth/login?redirect_uri=${encodeURIComponent(internalCallback)}&sig=signed`,
				"https://192.168.1.50:8000/auth/callback/extra",
				"https://192.168.1.50:8000/auth/callback.evil",
			]) {
				const policy = makeHttpOAuthRedirects(origin);
				expect(policy.toProvider(destination)).toBe(destination);
				const upstream = new Response(null, { status: 302, headers: { location: destination } });
				const handler = policy.wrapHandler(() => Promise.resolve(upstream));
				expect(
					yield* Effect.promise(() => handler(new Request(`${origin}/api/auth/sign-in/email`))),
				).toBe(upstream);
			}
		}),
	testTimeout,
);

it("preserves HTTPS and loopback deployments and maps configured ports reversibly", () => {
	for (const frontend of [
		"https://ryot.example",
		"http://localhost:8000",
		"http://127.0.0.2:8000",
		"http://[::1]:8000",
	]) {
		const policy = makeHttpOAuthRedirects(frontend);
		const handler = () => Promise.resolve(new Response(frontend));
		expect(policy.wrapHandler(handler)).toBe(handler);
		expect(policy.toProvider(`${frontend}/auth/callback`)).toBe(`${frontend}/auth/callback`);
	}
	for (const frontend of [
		"http://myapp.homelab.lan",
		"http://100.101.102.103:443",
		"http://192.168.1.50:8000",
	]) {
		const records = internalOAuthRecords(frontend, new Date(), true);
		const httpsOrigin = new URL(frontend);
		httpsOrigin.protocol = "https:";
		for (const client of records.clients.filter((entry) => entry.applicationType === "web")) {
			expect(client.redirectUris).toEqual([`${httpsOrigin.origin}/auth/callback`]);
			expect(client.postLogoutRedirectUris).toEqual([`${httpsOrigin.origin}/auth/logout/callback`]);
		}
		expect(records.resource.identifier).toBe(`${frontend}/api`);
	}
});
