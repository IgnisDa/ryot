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
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { Effect, Schema } from "effect";

import { requirePresent, requireString } from "~/support/assertions";
import { getApiUrl } from "~/support/harness-target";

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

const frontendOrigins = new Map<string, Promise<string>>();

const pendingTwoFactor = new Map<string, PendingOAuth>();

const randomValue = () =>
	Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export const responseCookie = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";", 1)[0])
		.filter((cookie): cookie is string => cookie !== undefined)
		.join("; ");

const getServerFrontendOrigin = (baseUrl: string) => {
	const serverOrigin = new URL(baseUrl).origin;
	const cached = frontendOrigins.get(serverOrigin);
	if (cached) {
		return cached;
	}
	const resolved = fetch(`${serverOrigin}/api/system/config`)
		.then((response) => response.json())
		.then((config: unknown) =>
			requireString(
				config !== null && typeof config === "object"
					? Reflect.get(config, "frontendOrigin")
					: null,
				`Server ${serverOrigin} did not expose its frontend origin`,
			),
		);
	frontendOrigins.set(serverOrigin, resolved);
	return resolved;
};

export const prepareOAuth = async (baseUrl: string): Promise<PendingOAuth> => {
	const serverOrigin = new URL(baseUrl).origin;
	const frontendOrigin = await getServerFrontendOrigin(baseUrl);
	const redirectUri = getWebOAuthCallbackUri(frontendOrigin);
	const state = randomValue();
	const codeVerifier = randomValue();
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
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
	const response = await fetch(authorizationUrl, { redirect: "manual" });
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
	};
};

export const continueOAuthAuthorization = (pending: PendingOAuth, sessionCookie: string) =>
	fetch(pending.authorizationUrl, {
		redirect: "manual",
		headers: { Cookie: sessionCookie },
	});

export const exchangeOAuthTokens = async (response: Response, pending: PendingOAuth) => {
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
	const tokenResponse = await fetch(getOAuthEndpoint(pending.serverOrigin, OAUTH_TOKEN_PATH), {
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
	});
	if (!tokenResponse.ok) {
		throw new Error(
			`OAuth token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`,
		);
	}
	return Schema.decodeUnknownSync(OAuthTokenResponse)(await tokenResponse.json());
};

export const exchangeOAuthCallback = async (response: Response, pending: PendingOAuth) => {
	const tokens = await exchangeOAuthTokens(response, pending);
	return tokens.access_token;
};

export const refreshOAuthTokens = async (baseUrl: string, refreshToken: string) => {
	const frontendOrigin = await getServerFrontendOrigin(baseUrl);
	return fetch(getOAuthEndpoint(new URL(baseUrl).origin, OAUTH_TOKEN_PATH), {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			refresh_token: refreshToken,
			grant_type: "refresh_token",
			client_id: OAUTH_WEB_CLIENT_ID,
			resource: getOAuthResource(frontendOrigin),
		}),
	});
};

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
	Effect.promise(async () => {
		const pending = await prepareOAuth(baseUrl);
		const completed = async (source: Response) => {
			const tokens = await exchangeOAuthTokens(source, pending);
			return { token: tokens.access_token, refreshToken: tokens.refresh_token };
		};
		const response = await fetch(`${pending.serverOrigin}/api/auth/sign-in/email`, {
			method: "POST",
			redirect: "manual",
			body: JSON.stringify({ email, password }),
			headers: {
				accept: "text/html",
				Origin: pending.frontendOrigin,
				"content-type": "application/json",
			},
		});
		const sessionCookie = responseCookie(response);
		if (response.status >= 400) {
			const payload: unknown = await response.json();
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
			const data: unknown = await response.json();
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
					...(await completed(
						new Response(null, { status: 302, headers: { location: redirectUrl } }),
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
					...(await completed(await continueOAuthAuthorization(pending, sessionCookie))),
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
			...(await completed(response)),
		};
	});

export const completeTwoFactorSignIn = async (
	baseUrl: string,
	twoFactorCookie: string,
	path: "/two-factor/verify-backup-code" | "/two-factor/verify-totp",
	body: Record<string, unknown>,
) => {
	const pending = requirePresent(
		pendingTwoFactor.get(twoFactorCookie),
		"Two-factor sign-in has no pending OAuth authorization",
	);
	pendingTwoFactor.delete(twoFactorCookie);
	const response = await fetch(`${new URL(baseUrl).origin}/api/auth${path}`, {
		method: "POST",
		redirect: "manual",
		body: JSON.stringify(body),
		headers: {
			accept: "text/html",
			Cookie: twoFactorCookie,
			Origin: pending.frontendOrigin,
			"content-type": "application/json",
		},
	});
	if (!response.headers.has("location")) {
		const data: unknown = await response.json();
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
					? await exchangeOAuthCallback(
							await continueOAuthAuthorization(pending, sessionCookie),
							pending,
						)
					: undefined,
			};
		}
		return {
			data,
			response,
			sessionCookie,
			token: await exchangeOAuthCallback(
				new Response(null, { status: 302, headers: { location: redirectUrl } }),
				pending,
			),
		};
	}
	return {
		response,
		data: null,
		sessionCookie: responseCookie(response) || undefined,
		token: await exchangeOAuthCallback(response, pending),
	};
};

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
		const client = makeSession(baseUrl, { Authorization: `Bearer ${token}` });
		return { client, token, email, userId, password, sessionCookie };
	});
