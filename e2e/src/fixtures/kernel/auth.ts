import { apiKeyClient } from "@better-auth/api-key/client";
import {
	OAuthTokenResponse,
	getOAuthEndpoint,
	getOAuthResource,
	getWebOAuthCallbackUri,
	OAUTH_AUTHORIZE_PATH,
	OAUTH_PKCE_METHOD,
	OAUTH_SCOPE,
	OAUTH_TOKEN_PATH,
	OAUTH_WEB_CLIENT_ID,
} from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { Clock, Effect, Schema } from "effect";

import { requirePresent, requireString } from "~/support/assertions";
import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

import { type ContractSession, makeSession } from "./contract-client";

export type Client = ContractSession;

type TestAuthClientOptions = {
	origin?: string;
	sessionCookie?: string;
	onSessionCookie?: (cookie: string) => void;
};

export type PendingOAuth = {
	state: string;
	redirectUri: string;
	codeVerifier: string;
	serverOrigin: string;
	frontendOrigin: string;
	authorizationUrl: string;
};

const frontendOrigins = new Map<string, string>();

const pendingTwoFactor = new Map<string, PendingOAuth>();
const InitializationStatus = Schema.Struct({ status: Schema.Literals(["initializing", "ready"]) });
const OAuthContinuation = Schema.Struct({ url: Schema.String });

const randomValue = () =>
	Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export const responseCookie = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";", 1)[0])
		.filter((cookie): cookie is string => cookie !== undefined)
		.join("; ");

const getServerFrontendOrigin = (baseUrl: string) =>
	Effect.gen(function* () {
		const serverOrigin = new URL(baseUrl).origin;
		const cached = frontendOrigins.get(serverOrigin);
		if (cached) {
			return cached;
		}
		const response = yield* webRequest(`${serverOrigin}/api/system/config`);
		const config: unknown = yield* Effect.promise(() => response.json());
		const resolved = requireString(
			config !== null && typeof config === "object" ? Reflect.get(config, "frontendOrigin") : null,
			`Server ${serverOrigin} did not expose its frontend origin`,
		);
		frontendOrigins.set(serverOrigin, resolved);
		return resolved;
	});

export const prepareOAuth = (baseUrl: string) =>
	Effect.gen(function* () {
		const serverOrigin = new URL(baseUrl).origin;
		const frontendOrigin = yield* getServerFrontendOrigin(baseUrl);
		const redirectUri = getWebOAuthCallbackUri(frontendOrigin);
		const state = randomValue();
		const codeVerifier = randomValue();
		const digest = yield* Effect.promise(() =>
			crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)),
		);
		const authorizationUrl = new URL(getOAuthEndpoint(serverOrigin, OAUTH_AUTHORIZE_PATH));
		authorizationUrl.search = new URLSearchParams({
			state,
			scope: OAUTH_SCOPE,
			nonce: randomValue(),
			response_type: "code",
			redirect_uri: redirectUri,
			client_id: OAUTH_WEB_CLIENT_ID,
			code_challenge_method: OAUTH_PKCE_METHOD,
			resource: getOAuthResource(frontendOrigin),
			code_challenge: Buffer.from(digest).toString("base64url"),
		}).toString();
		const response = yield* webRequest(authorizationUrl, { redirect: "manual" });
		requirePresent(
			response.headers.get("location"),
			`OAuth authorize did not redirect to login: ${response.status}`,
		);
		return {
			state,
			redirectUri,
			serverOrigin,
			codeVerifier,
			frontendOrigin,
			authorizationUrl: authorizationUrl.toString(),
		} satisfies PendingOAuth;
	});

export const continueOAuthAuthorization = (pending: PendingOAuth, sessionCookie: string) =>
	webRequest(pending.authorizationUrl, { redirect: "manual", headers: { Cookie: sessionCookie } });

export const continueAfterInitialization = (
	response: Response,
	pending: PendingOAuth,
	sessionCookie: string,
) =>
	Effect.gen(function* () {
		const location = response.headers.get("location");
		if (!location) {
			return response;
		}
		const initializationUrl = new URL(location, pending.serverOrigin);
		if (initializationUrl.pathname !== "/oauth/initializing") {
			return response;
		}

		const deadline = (yield* Clock.currentTimeMillis) + 120_000;
		while ((yield* Clock.currentTimeMillis) < deadline) {
			const statusResponse = yield* webRequest(
				`${pending.serverOrigin}/api/auth/initialization-status`,
				{ headers: { Cookie: sessionCookie } },
			);
			if (!statusResponse.ok) {
				throw new Error(`Initialization status failed: ${statusResponse.status}`);
			}
			const status = yield* Schema.decodeUnknownEffect(InitializationStatus)(
				yield* Effect.promise(() => statusResponse.json()),
			);
			if (status.status === "ready") {
				const continuation = yield* webRequest(`${pending.serverOrigin}/api/auth/oauth2/continue`, {
					method: "POST",
					headers: {
						Cookie: sessionCookie,
						Origin: pending.frontendOrigin,
						"content-type": "application/json",
					},
					body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
						postLogin: true,
						oauth_query: initializationUrl.search.slice(1),
					}),
				});
				if (!continuation.ok) {
					throw new Error(`OAuth continuation failed: ${continuation.status}`);
				}
				const payload = yield* Schema.decodeUnknownEffect(OAuthContinuation)(
					yield* Effect.promise(() => continuation.json()),
				);
				return new Response(null, { status: 302, headers: { location: payload.url } });
			}
			yield* Effect.sleep("200 millis");
		}
		throw new Error("Account initialization did not complete within 120 seconds");
	});

export const exchangeOAuthTokens = (response: Response, pending: PendingOAuth) =>
	Effect.gen(function* () {
		const location = requirePresent(
			response.headers.get("location"),
			`OAuth continuation did not redirect: ${response.status}`,
		);
		const callback = new URL(location, pending.serverOrigin);
		if (callback.searchParams.get("state") !== pending.state) {
			throw new Error("OAuth continuation returned the wrong state");
		}
		const code = requirePresent(
			callback.searchParams.get("code"),
			`OAuth continuation returned no code: ${location}`,
		);
		const tokenResponse = yield* webRequest(
			getOAuthEndpoint(pending.serverOrigin, OAUTH_TOKEN_PATH),
			{
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					code,
					client_id: OAUTH_WEB_CLIENT_ID,
					grant_type: "authorization_code",
					redirect_uri: pending.redirectUri,
					code_verifier: pending.codeVerifier,
					resource: getOAuthResource(new URL(pending.redirectUri).origin),
				}),
			},
		);
		if (!tokenResponse.ok) {
			throw new Error(
				`OAuth token exchange failed: ${tokenResponse.status} ${yield* Effect.promise(() => tokenResponse.text())}`,
			);
		}
		return yield* Schema.decodeUnknownEffect(OAuthTokenResponse)(
			yield* Effect.promise(() => tokenResponse.json()),
		);
	});

export const exchangeOAuthCallback = (response: Response, pending: PendingOAuth) =>
	exchangeOAuthTokens(response, pending).pipe(Effect.map((tokens) => tokens.access_token));

export const refreshOAuthTokens = (baseUrl: string, refreshToken: string) =>
	Effect.gen(function* () {
		const frontendOrigin = yield* getServerFrontendOrigin(baseUrl);
		return yield* webRequest(getOAuthEndpoint(new URL(baseUrl).origin, OAUTH_TOKEN_PATH), {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				refresh_token: refreshToken,
				grant_type: "refresh_token",
				client_id: OAUTH_WEB_CLIENT_ID,
				resource: getOAuthResource(frontendOrigin),
			}),
		});
	});

export const createTestAuthClient = (baseUrl = getApiUrl(), options: TestAuthClientOptions = {}) =>
	createAuthClient({
		baseURL: new URL(baseUrl).origin,
		plugins: [apiKeyClient(), twoFactorClient()],
		fetchOptions: {
			onResponse: ({ response }) => {
				const cookie = responseCookie(response);
				if (cookie) {
					options.onSessionCookie?.(cookie);
				}
			},
			...(options.origin || options.sessionCookie
				? {
						headers: {
							...(options.origin ? { Origin: options.origin } : {}),
							...(options.sessionCookie ? { Cookie: options.sessionCookie } : {}),
						},
					}
				: {}),
		},
	});

export const signInWithPassword = (email: string, password: string, baseUrl = getApiUrl()) =>
	Effect.gen(function* () {
		const pending = yield* prepareOAuth(baseUrl);
		const completed = Effect.fnUntraced(function* (source: Response, sessionCookie: string) {
			const continued = yield* continueAfterInitialization(source, pending, sessionCookie);
			const tokens = yield* exchangeOAuthTokens(continued, pending);
			return { token: tokens.access_token, refreshToken: tokens.refresh_token };
		});
		const response = yield* webRequest(`${pending.serverOrigin}/api/auth/sign-in/email`, {
			method: "POST",
			redirect: "manual",
			body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({ email, password }),
			headers: {
				accept: "text/html",
				Origin: pending.frontendOrigin,
				"content-type": "application/json",
			},
		});
		const sessionCookie = responseCookie(response);
		if (response.status >= 400) {
			const payload: unknown = yield* Effect.promise(() => response.json());
			const message = ["message", "error_description", "error", "code"]
				.map((key) =>
					payload !== null && typeof payload === "object" ? Reflect.get(payload, key) : null,
				)
				.find((value): value is string => typeof value === "string");
			return {
				data: null,
				sessionCookie,
				token: undefined,
				refreshToken: undefined,
				twoFactorToken: undefined,
				error: { message, status: response.status },
			};
		}
		if (!response.headers.has("location")) {
			const data: unknown = yield* Effect.promise(() => response.json());
			const redirectUrl =
				data !== null && typeof data === "object" && typeof Reflect.get(data, "url") === "string"
					? Reflect.get(data, "url")
					: null;
			if (redirectUrl) {
				return {
					data,
					error: null,
					sessionCookie,
					twoFactorToken: undefined,
					...(yield* completed(
						new Response(null, { status: 302, headers: { location: redirectUrl } }),
						sessionCookie,
					)),
				};
			}
			const needsTwoFactor =
				data !== null &&
				typeof data === "object" &&
				Reflect.get(data, "twoFactorRedirect") === true;
			if (!needsTwoFactor && sessionCookie) {
				return {
					data,
					error: null,
					sessionCookie,
					twoFactorToken: undefined,
					...(yield* completed(
						yield* continueOAuthAuthorization(pending, sessionCookie),
						sessionCookie,
					)),
				};
			}
			if (sessionCookie) {
				pendingTwoFactor.set(sessionCookie, pending);
			}
			return {
				data,
				error: null,
				token: undefined,
				refreshToken: undefined,
				sessionCookie: undefined,
				twoFactorToken: sessionCookie || undefined,
			};
		}
		return {
			data: {},
			error: null,
			sessionCookie,
			twoFactorToken: undefined,
			...(yield* completed(response, sessionCookie)),
		};
	});

export const completeTwoFactorSignIn = (
	baseUrl: string,
	twoFactorCookie: string,
	path: "/two-factor/verify-backup-code" | "/two-factor/verify-totp",
	body: Record<string, unknown>,
) =>
	Effect.gen(function* () {
		const pending = requirePresent(
			pendingTwoFactor.get(twoFactorCookie),
			"Two-factor sign-in has no pending OAuth authorization",
		);
		pendingTwoFactor.delete(twoFactorCookie);
		const response = yield* webRequest(`${new URL(baseUrl).origin}/api/auth${path}`, {
			method: "POST",
			redirect: "manual",
			body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body),
			headers: {
				accept: "text/html",
				Cookie: twoFactorCookie,
				Origin: pending.frontendOrigin,
				"content-type": "application/json",
			},
		});
		if (!response.headers.has("location")) {
			const data: unknown = yield* Effect.promise(() => response.json());
			const sessionCookie = responseCookie(response) || undefined;
			const redirectUrl =
				data !== null && typeof data === "object" && typeof Reflect.get(data, "url") === "string"
					? Reflect.get(data, "url")
					: null;
			if (!redirectUrl) {
				return {
					data,
					response,
					sessionCookie,
					token: sessionCookie
						? yield* exchangeOAuthCallback(
								yield* continueAfterInitialization(
									yield* continueOAuthAuthorization(pending, sessionCookie),
									pending,
									sessionCookie,
								),
								pending,
							)
						: undefined,
				};
			}
			return {
				data,
				response,
				sessionCookie,
				token: sessionCookie
					? yield* exchangeOAuthCallback(
							yield* continueAfterInitialization(
								new Response(null, { status: 302, headers: { location: redirectUrl } }),
								pending,
								sessionCookie,
							),
							pending,
						)
					: undefined,
			};
		}
		const sessionCookie = responseCookie(response) || undefined;
		return {
			response,
			data: null,
			sessionCookie,
			token: sessionCookie
				? yield* exchangeOAuthCallback(
						yield* continueAfterInitialization(response, pending, sessionCookie),
						pending,
					)
				: undefined,
		};
	});

export const createApiKey = (sessionCookie: string, name = "E2E key", baseUrl = getApiUrl()) =>
	Effect.gen(function* () {
		const authClient = createTestAuthClient(baseUrl, { sessionCookie });
		const { data, error } = yield* Effect.promise(() => authClient.apiKey.create({ name }));
		if (error) {
			throw new Error(`API key creation failed: ${error.message}`);
		}
		return requireString(
			requirePresent(data, "API key creation did not return data").key,
			"API key creation did not return a key",
		);
	});

export const createTestUser = (baseUrl = getApiUrl()) =>
	Effect.gen(function* () {
		const password = "password123";
		const authClient = createTestAuthClient(baseUrl);
		const email = `test-${crypto.randomUUID()}@example.com`;
		const { data: signUpData, error: signUpError } = yield* Effect.promise(() =>
			authClient.signUp.email({ email, password, name: "Test User" }),
		);
		if (signUpError) {
			throw new Error(`Sign up failed: ${signUpError.message}`);
		}
		const userId = requireString(
			requirePresent(signUpData, "Sign up did not return a user").user.id,
			"Sign up did not return a user ID",
		);
		const signIn = yield* signInWithPassword(email, password, baseUrl);
		if (signIn.error) {
			throw new Error(`Sign in failed: ${signIn.error.message}`);
		}
		const token = requirePresent(signIn.token, "Failed to get OAuth access token");
		const refreshToken = requirePresent(signIn.refreshToken, "Failed to get OAuth refresh token");
		const sessionCookie = requirePresent(
			signIn.sessionCookie,
			"Failed to get browser session cookie",
		);
		return { token, email, userId, password, refreshToken, sessionCookie };
	});

export const createAuthenticatedClient = (baseUrl = getApiUrl()) =>
	Effect.gen(function* () {
		const { token, email, userId, password, sessionCookie } = yield* createTestUser(baseUrl);
		const client = makeSession(baseUrl, { Authorization: `Bearer ${token}` }, UserId.make(userId));
		return { token, email, client, userId, password, sessionCookie };
	});
