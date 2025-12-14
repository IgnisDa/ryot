import type { paths } from "@ryot/generated/openapi/app-backend";
import type createClient from "openapi-fetch";
import { getBackendClient, getBackendUrl } from "../setup";

export type Client = ReturnType<typeof createClient<paths>>;

export async function createTestUser() {
	const password = "password123";
	const baseUrl = getBackendUrl();
	const email = `test-${Date.now()}@example.com`;

	const signUpResponse = await fetch(`${baseUrl}/authentication/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, name: "Test User", password }),
	});

	if (!signUpResponse.ok) {
		const error = await signUpResponse.text();
		throw new Error(`Sign up failed: ${error}`);
	}

	const signInResponse = await fetch(`${baseUrl}/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});

	if (!signInResponse.ok) {
		const error = await signInResponse.text();
		throw new Error(`Sign in failed: ${error}`);
	}

	const cookies = signInResponse.headers.get("set-cookie");
	if (!cookies) {
		throw new Error("Failed to get auth cookies");
	}

	return { cookies, email, password };
}

export async function createAuthenticatedClient() {
	const client = getBackendClient();
	const { cookies, email, password } = await createTestUser();
	return { client, cookies, email, password };
}
