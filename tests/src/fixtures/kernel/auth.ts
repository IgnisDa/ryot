import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { Effect } from "effect";

import { requirePresent, requireString } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";

import { type ContractSession, makeSession } from "./contract-client";

export type Client = ContractSession;

type TestAuthClientOptions = {
	cookies?: string;
	origin?: string;
	onSetCookies?: (cookies: string[]) => void;
};

export function cookieHeaderFromSetCookies(setCookies: string[]) {
	return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

export const createTestAuthClient = (
	baseUrl = getBackendUrl(),
	options: TestAuthClientOptions = {},
) =>
	createAuthClient({
		baseURL: new URL(baseUrl).origin,
		plugins: [apiKeyClient(), twoFactorClient()],
		fetchOptions: {
			...(options.cookies || options.origin
				? {
						headers: {
							...(options.cookies ? { Cookie: options.cookies } : {}),
							...(options.origin ? { Origin: options.origin } : {}),
						},
					}
				: {}),
			onResponse: ({ response }) => {
				const setCookies = response.headers.getSetCookie();
				if (setCookies.length) {
					options.onSetCookies?.(setCookies);
				}
			},
		},
	});

export const signInWithPassword = (email: string, password: string, baseUrl = getBackendUrl()) =>
	Effect.gen(function* () {
		let cookies: string | undefined;
		const authClient = createTestAuthClient(baseUrl, {
			onSetCookies: (setCookies) => {
				cookies = cookieHeaderFromSetCookies(setCookies);
			},
		});
		const { data, error } = yield* Effect.promise(() =>
			authClient.signIn.email({ email, password }),
		);
		return { data, error, cookies };
	});

export const createApiKey = (cookies: string, name = "E2E key", baseUrl = getBackendUrl()) =>
	Effect.gen(function* () {
		const authClient = createTestAuthClient(baseUrl, { cookies });
		const { data, error } = yield* Effect.promise(() => authClient.apiKey.create({ name }));
		if (error) {
			throw new Error(`API key creation failed: ${error.message}`);
		}
		return requireString(
			requirePresent(data, "API key creation did not return data").key,
			"API key creation did not return a key",
		);
	});

export const createTestUser = (baseUrl = getBackendUrl()) =>
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
		const cookies = requirePresent(signIn.cookies, "Failed to get auth cookies");

		return { cookies, email, userId, password };
	});

export const createAuthenticatedClient = (baseUrl = getBackendUrl()) =>
	Effect.gen(function* () {
		const { cookies, email, userId } = yield* createTestUser(baseUrl);
		const client = makeSession(baseUrl, { Cookie: cookies });
		return { client, cookies, email, userId };
	});
