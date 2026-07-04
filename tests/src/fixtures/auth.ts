import { createAuthClient } from "better-auth/client";

import { getBackendUrl } from "~/setup";
import { requireNonEmptyArray, requirePresent, requireString } from "~/support/assertions";

import { cookieHeaderFromSetCookies } from "./auth-2fa";
import { type ContractSession, makeSession } from "./contract-client";

export type Client = ContractSession;

export const createTestAuthClient = (baseUrl = getBackendUrl()) =>
	createAuthClient({ baseURL: new URL(baseUrl).origin });

export async function createTestUser(baseUrl = getBackendUrl()) {
	const password = "password123";
	const email = `test-${crypto.randomUUID()}@example.com`;
	const authClient = createTestAuthClient(baseUrl);

	const { data: signUpData, error: signUpError } = await authClient.signUp.email({
		email,
		password,
		name: "Test User",
	});

	if (signUpError) {
		throw new Error(`Sign up failed: ${signUpError.message}`);
	}
	const userId = requireString(
		requirePresent(signUpData, "Sign up did not return a user").user.id,
		"Sign up did not return a user ID",
	);

	const signInResponse = await fetch(`${baseUrl}/auth/sign-in/email`, {
		method: "POST",
		body: JSON.stringify({ email, password }),
		headers: { "Content-Type": "application/json" },
	});

	if (!signInResponse.ok) {
		const error = await signInResponse.text();
		throw new Error(`Sign in failed: ${error}`);
	}

	const setCookies = signInResponse.headers.getSetCookie();
	const cookies = cookieHeaderFromSetCookies(
		requireNonEmptyArray(setCookies, "Failed to get auth cookies"),
	);

	return { cookies, email, userId, password };
}

export async function createAuthenticatedClient(baseUrl = getBackendUrl()) {
	const { cookies, email, userId } = await createTestUser(baseUrl);
	const client = makeSession(baseUrl, { Cookie: cookies });
	return { client, cookies, email, userId };
}
