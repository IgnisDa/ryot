import { expect } from "bun:test";

import { oauthProvider } from "@better-auth/oauth-provider";
import { getMcpOAuthResource, OAUTH_MCP_SCOPES, OAUTH_SCOPES } from "@ryot-app/contract/oauth";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { applySetCookies } from "better-auth/cookies";
import { jwt } from "better-auth/plugins";
import { Effect, Schema } from "effect";

import { mcpOAuthOptions, mcpOAuthPlugin } from "./mcp-oauth-plugin";

const origin = "http://localhost:3000";
const Registration = Schema.Struct({ client_id: Schema.String });
const Continuation = Schema.Struct({ url: Schema.String });
const makeAuth = () =>
	betterAuth({
		baseURL: origin,
		rateLimit: { enabled: false },
		emailAndPassword: { enabled: true },
		secret: "mcp-oauth-test-secret-with-at-least-32-characters",
		database: memoryAdapter({
			user: [],
			jwks: [],
			session: [],
			account: [],
			oauthClient: [],
			verification: [],
			oauthConsent: [],
			oauthResource: [],
			oauthAccessToken: [],
			oauthRefreshToken: [],
			oauthClientResource: [],
		}),
		plugins: [
			jwt(),
			mcpOAuthPlugin(origin),
			oauthProvider({
				...mcpOAuthOptions(origin),
				scopes: [...OAUTH_SCOPES],
				loginPage: "/oauth/login",
				consentPage: "/oauth/consent",
				grantTypes: ["authorization_code", "refresh_token"],
			}),
		],
	});

it.live(
	"registers only public clients, verifies consent display and requires a fresh consent ceremony",
	() =>
		Effect.gen(function* () {
			const auth = makeAuth();
			const send = (path: string, body: unknown, cookie?: Headers) =>
				Effect.gen(function* () {
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
			const rejected = yield* send("/oauth2/register", {
				token_endpoint_auth_method: "client_secret_basic",
				redirect_uris: ["https://client.example/callback"],
			});
			expect(rejected.status).toBe(400);
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
			const registered = yield* send("/oauth2/register", {
				response_types: ["code"],
				client_name: "Example Client",
				scope: OAUTH_MCP_SCOPES.join(" "),
				token_endpoint_auth_method: "none",
				redirect_uris: ["https://client.example/callback"],
				grant_types: ["authorization_code", "refresh_token"],
			});
			expect(registered.status).toBe(201);
			const { client_id } = yield* Schema.decodeUnknownEffect(Registration)(
				yield* Effect.promise(() => registered.json()),
			);
			const authorize = new URL(`${origin}/api/auth/oauth2/authorize`);
			authorize.search = new URLSearchParams({
				client_id,
				response_type: "code",
				state: "request-state",
				code_challenge_method: "S256",
				scope: OAUTH_MCP_SCOPES.join(" "),
				resource: getMcpOAuthResource(origin),
				redirect_uri: "https://client.example/callback",
				code_challenge: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
			}).toString();
			const begin = () =>
				Effect.promise(() =>
					auth.handler(new Request(authorize.toString(), { headers: cookie, redirect: "manual" })),
				);
			const authorization = yield* begin();
			expect(authorization.status).toBe(302);
			const consent = new URL(authorization.headers.get("location") ?? "", origin);
			expect(consent.pathname).toBe("/oauth/consent");
			const signed = consent.search.slice(1);
			const missingSession = yield* send("/oauth2/consent-details", { oauth_query: signed });
			expect(missingSession.status).toBe(401);
			const invalid = yield* send("/oauth2/consent-details", {
				oauth_query: `${signed}&scope=other`,
			});
			expect(invalid.status).toBe(400);
			const details = yield* send("/oauth2/consent-details", { oauth_query: signed }, cookie);
			expect(details.status).toBe(200);
			expect(yield* Effect.promise(() => details.json())).toEqual({
				scope: "ryot:api",
				clientName: "Example Client",
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
		}),
	testTimeout,
);
