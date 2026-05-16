import type { paths } from "@ryot/generated/openapi/app-backend";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { createAuthClient } from "better-auth/client";
import type createClient from "openapi-fetch";

import { getBackendClient, getBackendUrl, getPgClient } from "../setup";
import { cookieHeaderFromSetCookies } from "./auth-2fa";

export type Client = ReturnType<typeof createClient<paths>>;

export const createTestAuthClient = (baseUrl = getBackendUrl()) =>
	createAuthClient({ baseURL: new URL(baseUrl).origin });

async function getUserIdByEmail(email: string) {
	const result = await getPgClient().query<{ id: string }>(
		`select id from "user" where email = $1 limit 1`,
		[email],
	);
	const row = result.rows[0];
	if (!row) {
		throw new Error(`Failed to find user '${email}'`);
	}

	return row.id;
}

export async function createTestUser() {
	const password = "password123";
	const baseUrl = getBackendUrl();
	const email = `test-${dayjs().valueOf()}@example.com`;
	const authClient = createTestAuthClient(baseUrl);

	const { error: signUpError } = await authClient.signUp.email({
		email,
		password,
		name: "Test User",
	});

	if (signUpError) {
		throw new Error(`Sign up failed: ${signUpError.message}`);
	}

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
	if (!setCookies.length) {
		throw new Error("Failed to get auth cookies");
	}
	const cookies = cookieHeaderFromSetCookies(setCookies);

	return { cookies, email, password };
}

export async function createAuthenticatedClient() {
	const client = getBackendClient();
	const { cookies, email } = await createTestUser();
	const userId = await getUserIdByEmail(email);
	return { client, cookies, email, userId };
}
