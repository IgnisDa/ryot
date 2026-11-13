import { expect } from "bun:test";

import { oauthProvider } from "@better-auth/oauth-provider";
import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { getMcpOAuthResource, getOAuthResource } from "@ryot-app/contract/oauth";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { applySetCookies } from "better-auth/cookies";
import { verifyBearerToken } from "better-auth/oauth2";
import { jwt } from "better-auth/plugins";
import { DateTime, Effect, Schema } from "effect";

import { mcpOAuthPlugin } from "./mcp-oauth-plugin";
import { oauthProviderOptions } from "./oauth-policy";
import { internalOAuthRecords } from "./oauth-provisioning";
import { getOAuthVerificationOptions } from "./service";

const origin = "http://localhost:3000";
const callback = "https://client.example/callback";
const verifier = "a-pkce-verifier-with-at-least-forty-three-characters";
const Registration = Schema.Struct({ scope: Schema.String, client_id: Schema.String });
const Continuation = Schema.Struct({ url: Schema.String });
const Tokens = Schema.Struct({
	scope: Schema.String,
	access_token: Schema.String,
	id_token: Schema.optional(Schema.String),
	refresh_token: Schema.optional(Schema.String),
});
const IdClaims = Schema.Struct({
	sub: Schema.String,
	aud: Schema.String,
	iss: Schema.String,
	nonce: Schema.String,
});

const makeHarness = Effect.fn(function* () {
	const records = internalOAuthRecords(origin, yield* DateTime.nowAsDate, false);
	const auth = betterAuth({
		baseURL: origin,
		rateLimit: { enabled: false },
		emailAndPassword: { enabled: true },
		secret: "mcp-oauth-test-secret-with-at-least-32-characters",
		plugins: [
			jwt(),
			mcpOAuthPlugin(origin),
			oauthProvider({
				...oauthProviderOptions(origin),
				loginPage: "/oauth/login",
				consentPage: "/oauth/consent",
				grantTypes: ["authorization_code", "refresh_token"],
			}),
		],
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
			oauthClientResource: [...records.links],
			oauthResource: [records.resource, records.mcpResource],
		}),
	});
	const server = yield* Effect.acquireRelease(
		Effect.sync(() => Bun.serve({ port: 0, fetch: auth.handler, hostname: "127.0.0.1" })),
		(runningServer) => Effect.promise(() => runningServer.stop(true)),
	);
	const send = Effect.fn(function* (path: string, body: unknown, cookie?: Headers) {
		const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body);
		return yield* Effect.promise(() =>
			auth.handler(
				new Request(`${origin}/api/auth${path}`, {
					body: encoded,
					method: "POST",
					headers: {
						origin,
						"content-type": "application/json",
						...(cookie ? { cookie: cookie.get("cookie") ?? "" } : {}),
					},
				}),
			),
		);
	});
	const signup = yield* Effect.promise(() =>
		auth.api.signUpEmail({
			returnHeaders: true,
			body: {
				name: "Owner",
				email: "owner@example.com",
				password: "password-with-enough-characters",
			},
		}),
	);
	const cookie = new Headers();
	applySetCookies(cookie, signup.headers.getSetCookie());
	const challenge = yield* Effect.promise(() =>
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	);
	const register = (scope?: string) =>
		send("/oauth2/register", {
			scope,
			response_types: ["code"],
			redirect_uris: [callback],
			client_name: "Example Client",
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
		});
	const authorize = (clientId: string, scope: string, resource = getMcpOAuthResource(origin)) => {
		const url = new URL(`${origin}/api/auth/oauth2/authorize`);
		url.search = new URLSearchParams({
			scope,
			resource,
			client_id: clientId,
			response_type: "code",
			redirect_uri: callback,
			state: "request-state",
			nonce: "request-nonce",
			code_challenge_method: "S256",
			code_challenge: Buffer.from(challenge).toString("base64url"),
		}).toString();
		return Effect.promise(() =>
			auth.handler(new Request(url.href, { headers: cookie, redirect: "manual" })),
		);
	};
	const token = (body: Record<string, string>) =>
		Effect.promise(() =>
			auth.handler(
				new Request(`${origin}/api/auth/oauth2/token`, {
					method: "POST",
					body: new URLSearchParams(body),
					headers: { "content-type": "application/x-www-form-urlencoded" },
				}),
			),
		);
	const userInfo = (accessToken: string) =>
		Effect.promise(() =>
			auth.handler(
				new Request(`${origin}/api/auth/oauth2/userinfo`, {
					headers: { authorization: `Bearer ${accessToken}` },
				}),
			),
		);
	const verify = (accessToken: string, resource = getMcpOAuthResource(origin)) =>
		Effect.tryPromise({
			catch: () => new AuthUnauthorized({ reason: { code: "authentication-required" } }),
			try: () =>
				verifyBearerToken(accessToken, {
					...getOAuthVerificationOptions(origin, resource),
					jwksUrl: new URL("/api/auth/jwks", server.url).href,
				}),
		});
	return { send, token, cookie, verify, register, userInfo, authorize, user: signup.response.user };
});

it.live(
	"registers only public clients, verifies consent display and requires a fresh consent ceremony",
	() =>
		Effect.gen(function* () {
			const { send, cookie, register, authorize } = yield* makeHarness();
			expect(
				(yield* send("/oauth2/register", {
					redirect_uris: [callback],
					token_endpoint_auth_method: "client_secret_basic",
				})).status,
			).toBe(400);
			expect((yield* register("unknown")).status).toBe(400);
			const registered = yield* register("ryot:api offline_access");
			expect(registered.status).toBe(201);
			const { client_id } = yield* Schema.decodeUnknownEffect(Registration)(
				yield* Effect.promise(() => registered.json()),
			);
			const begin = () => authorize(client_id, "ryot:api offline_access");
			const authorization = yield* begin();
			expect(authorization.status).toBe(302);
			const consent = new URL(authorization.headers.get("location") ?? "", origin);
			expect(consent.pathname).toBe("/oauth/consent");
			const signed = consent.search.slice(1);
			expect((yield* send("/oauth2/consent-details", { oauth_query: signed })).status).toBe(401);
			expect(
				(yield* send("/oauth2/consent-details", { oauth_query: `${signed}&scope=other` })).status,
			).toBe(400);
			const details = yield* send("/oauth2/consent-details", { oauth_query: signed }, cookie);
			expect(details.status).toBe(200);
			expect(yield* Effect.promise(() => details.json())).toEqual({
				clientName: "Example Client",
				scopes: ["ryot:api", "offline_access"],
				redirectOrigin: "https://client.example",
			});
			const denied = yield* send("/oauth2/consent", { accept: false, oauth_query: signed }, cookie);
			expect(denied.status).toBe(200);
			const denial = yield* Schema.decodeUnknownEffect(Continuation)(
				yield* Effect.promise(() => denied.json()),
			);
			expect(new URL(denial.url).searchParams.get("error")).toBe("access_denied");
			const accepted = yield* send(
				"/oauth2/consent",
				{ accept: true, oauth_query: signed },
				cookie,
			);
			expect(accepted.status).toBe(200);
			const approval = yield* Schema.decodeUnknownEffect(Continuation)(
				yield* Effect.promise(() => accepted.json()),
			);
			expect(new URL(approval.url).searchParams.get("code")).toBeString();
			const repeated = yield* begin();
			expect(new URL(repeated.headers.get("location") ?? "", origin).pathname).toBe(
				"/oauth/consent",
			);
			const forged = new URLSearchParams(signed);
			forged.set("redirect_uri", "https://attacker.example/callback");
			expect(
				(yield* send("/oauth2/consent-details", { oauth_query: forged.toString() }, cookie)).status,
			).toBe(400);
			const invalidScope = yield* authorize(client_id, "unknown ryot:api");
			expect(invalidScope.status).toBe(302);
			expect(
				new URL(invalidScope.headers.get("location") ?? "", origin).searchParams.get("error"),
			).toBe("invalid_scope");
		}).pipe(Effect.scoped),
	testTimeout,
);

it.live.each([
	{ email: false, profile: false, refresh: false, identity: false, scope: "ryot:api" },
	{
		email: false,
		refresh: true,
		profile: false,
		identity: false,
		scope: "ryot:api offline_access",
	},
	{ email: true, identity: true, profile: false, refresh: false, scope: "openid email ryot:api" },
	{ email: false, identity: true, profile: false, refresh: false, scope: "openid ryot:api" },
	{
		email: true,
		profile: true,
		refresh: true,
		identity: true,
		scope: "openid email profile offline_access ryot:api",
	},
])(
	"issues only the approved permissions and claims for $scope",
	({ scope, email, profile, refresh, identity }) =>
		Effect.gen(function* () {
			const { send, user, token, cookie, verify, register, userInfo, authorize } =
				yield* makeHarness();
			const registered = yield* register("openid email profile offline_access ryot:api");
			expect(registered.status).toBe(201);
			const registration = yield* Schema.decodeUnknownEffect(Registration)(
				yield* Effect.promise(() => registered.json()),
			);
			expect(new Set(registration.scope.split(" "))).toEqual(
				new Set(["email", "openid", "profile", "ryot:api", "offline_access"]),
			);
			const authorization = yield* authorize(registration.client_id, scope);
			expect(authorization.status).toBe(302);
			const consent = new URL(authorization.headers.get("location") ?? "", origin);
			expect(consent.pathname).toBe("/oauth/consent");
			const signed = consent.search.slice(1);
			const details = yield* send("/oauth2/consent-details", { oauth_query: signed }, cookie);
			expect(details.status).toBe(200);
			expect(yield* Effect.promise(() => details.json())).toEqual({
				scopes: scope.split(" "),
				clientName: "Example Client",
				redirectOrigin: "https://client.example",
			});
			const accepted = yield* send(
				"/oauth2/consent",
				{ accept: true, oauth_query: signed },
				cookie,
			);
			expect(accepted.status).toBe(200);
			const approval = yield* Schema.decodeUnknownEffect(Continuation)(
				yield* Effect.promise(() => accepted.json()),
			);
			const code = new URL(approval.url).searchParams.get("code");
			assert(code !== null);
			const exchanged = yield* token({
				code,
				redirect_uri: callback,
				code_verifier: verifier,
				grant_type: "authorization_code",
				client_id: registration.client_id,
				resource: getMcpOAuthResource(origin),
			});
			expect(exchanged.status).toBe(200);
			const tokens = yield* Schema.decodeUnknownEffect(Tokens)(
				yield* Effect.promise(() => exchanged.json()),
			);
			expect(new Set(tokens.scope.split(" "))).toEqual(new Set(scope.split(" ")));
			const access = yield* verify(tokens.access_token);
			expect(access.sub).toBe(user.id);
			expect(new Set(String(access["scope"]).split(" "))).toEqual(new Set(scope.split(" ")));
			yield* Effect.flip(verify(tokens.access_token, getOAuthResource(origin)));
			expect(Boolean(tokens.id_token)).toBe(identity);
			expect(Boolean(tokens.refresh_token)).toBe(refresh);
			const info = yield* userInfo(tokens.access_token);
			if (identity) {
				assert(tokens.id_token !== undefined);
				const payload = tokens.id_token.split(".")[1];
				assert(payload !== undefined);
				const claims = yield* Schema.decodeEffect(Schema.fromJsonString(IdClaims))(
					Buffer.from(payload, "base64url").toString(),
				);
				expect(claims).toEqual({
					sub: user.id,
					nonce: "request-nonce",
					iss: `${origin}/api/auth`,
					aud: registration.client_id,
				});
				expect(info.status).toBe(200);
				expect(yield* Effect.promise(() => info.json())).toEqual({
					sub: user.id,
					...(email ? { email_verified: false, email: "owner@example.com" } : {}),
					...(profile ? { name: "Owner" } : {}),
				});
			} else {
				expect(info.status).toBe(400);
			}
			if (refresh) {
				assert(tokens.refresh_token !== undefined);
				const refreshed = yield* token({
					grant_type: "refresh_token",
					client_id: registration.client_id,
					refresh_token: tokens.refresh_token,
					resource: getMcpOAuthResource(origin),
				});
				expect(refreshed.status).toBe(200);
				const renewed = yield* Schema.decodeUnknownEffect(Tokens)(
					yield* Effect.promise(() => refreshed.json()),
				);
				expect(new Set(renewed.scope.split(" "))).toEqual(new Set(scope.split(" ")));
				yield* verify(renewed.access_token);
				assert(renewed.refresh_token !== undefined);
				const wrongResource = yield* token({
					grant_type: "refresh_token",
					client_id: registration.client_id,
					resource: getOAuthResource(origin),
					refresh_token: renewed.refresh_token,
				});
				expect(wrongResource.status).toBe(400);
				const escalated = yield* token({
					scope: `${scope} unknown`,
					grant_type: "refresh_token",
					client_id: registration.client_id,
					refresh_token: renewed.refresh_token,
					resource: getMcpOAuthResource(origin),
				});
				expect(escalated.status).toBe(400);
			}
		}).pipe(Effect.scoped),
	testTimeout,
);

it.live(
	"keeps identity grants separate from data access and restricts registration to MCP",
	() =>
		Effect.gen(function* () {
			const { send, token, cookie, verify, register, authorize } = yield* makeHarness();
			const registered = yield* register();
			expect(registered.status).toBe(201);
			const defaults = yield* Schema.decodeUnknownEffect(Registration)(
				yield* Effect.promise(() => registered.json()),
			);
			expect(new Set(defaults.scope.split(" "))).toEqual(
				new Set(["email", "openid", "profile", "ryot:api", "offline_access"]),
			);
			const oidc = yield* register("openid email");
			expect(oidc.status).toBe(201);
			const { client_id } = yield* Schema.decodeUnknownEffect(Registration)(
				yield* Effect.promise(() => oidc.json()),
			);
			const api = yield* authorize(client_id, "openid email", getOAuthResource(origin));
			expect(api.status).toBe(302);
			expect(new URL(api.headers.get("location") ?? "", origin).searchParams.get("error")).toBe(
				"invalid_target",
			);
			const authorization = yield* authorize(client_id, "openid email");
			expect(authorization.status).toBe(302);
			const signed = new URL(authorization.headers.get("location") ?? "", origin).search.slice(1);
			expect((yield* send("/oauth2/consent-details", { oauth_query: signed }, cookie)).status).toBe(
				400,
			);
			const accepted = yield* send(
				"/oauth2/consent",
				{ accept: true, oauth_query: signed },
				cookie,
			);
			const approval = yield* Schema.decodeUnknownEffect(Continuation)(
				yield* Effect.promise(() => accepted.json()),
			);
			const code = new URL(approval.url).searchParams.get("code");
			assert(code !== null);
			const exchanged = yield* token({
				code,
				client_id,
				redirect_uri: callback,
				code_verifier: verifier,
				grant_type: "authorization_code",
				resource: getMcpOAuthResource(origin),
			});
			expect(exchanged.status).toBe(200);
			const tokens = yield* Schema.decodeUnknownEffect(Tokens)(
				yield* Effect.promise(() => exchanged.json()),
			);
			expect(tokens.scope).toBe("openid email");
			yield* Effect.flip(verify(tokens.access_token));
		}).pipe(Effect.scoped),
	testTimeout,
);
