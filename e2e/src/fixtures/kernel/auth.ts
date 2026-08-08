import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { Effect } from "effect";

import { getApiUrl } from "~/support/api";
import { requirePresent, requireString } from "~/support/assertions";

import { type ContractSession, makeSession } from "./contract-client";

export type Client = ContractSession;

type TestAuthClientOptions = {
	token?: string;
	origin?: string;
	twoFactorToken?: string;
	onSetToken?: (token: string) => void;
	onSetTwoFactorToken?: (token: string) => void;
};

export const createTestAuthClient = (baseUrl = getApiUrl(), options: TestAuthClientOptions = {}) =>
	createAuthClient({
		baseURL: new URL(baseUrl).origin,
		plugins: [apiKeyClient(), twoFactorClient()],
		fetchOptions: {
			...(options.token || options.origin || options.twoFactorToken
				? {
						headers: {
							...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
							...(options.origin ? { Origin: options.origin } : {}),
							...(options.twoFactorToken ? { "x-two-factor-token": options.twoFactorToken } : {}),
						},
					}
				: {}),
			onResponse: ({ response }) => {
				const token = response.headers.get("set-auth-token");
				if (token) {
					options.onSetToken?.(token);
				}
				const challenge = response.headers.get("set-two-factor-token");
				if (challenge) {
					options.onSetTwoFactorToken?.(challenge);
				}
			},
		},
	});

export const signInWithPassword = (email: string, password: string, baseUrl = getApiUrl()) =>
	Effect.gen(function* () {
		let token: string | undefined;
		let twoFactorToken: string | undefined;
		const authClient = createTestAuthClient(baseUrl, {
			onSetToken: (setToken) => {
				token = setToken;
			},
			onSetTwoFactorToken: (setToken) => {
				twoFactorToken = setToken;
			},
		});
		const { data, error } = yield* Effect.promise(() =>
			authClient.signIn.email({ email, password }),
		);
		return { data, error, token, twoFactorToken };
	});

export const createApiKey = (token: string, name = "E2E key", baseUrl = getApiUrl()) =>
	Effect.gen(function* () {
		const authClient = createTestAuthClient(baseUrl, { token });
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
		const token = requirePresent(signIn.token, "Failed to get auth token");

		return { token, email, userId, password };
	});

export const createAuthenticatedClient = (baseUrl = getApiUrl()) =>
	Effect.gen(function* () {
		const { token, email, userId } = yield* createTestUser(baseUrl);
		const client = makeSession(baseUrl, { Authorization: `Bearer ${token}` });
		return { client, token, email, userId };
	});
