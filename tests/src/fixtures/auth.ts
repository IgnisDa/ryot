import type { paths } from "@ryot/generated/openapi/app-backend";
import { dayjs } from "@ryot/ts-utils";
import type createClient from "openapi-fetch";
import { Client as PgClient } from "pg";
import { getBackendClient, getBackendUrl, getTestDatabaseUrl } from "../setup";

export type Client = ReturnType<typeof createClient<paths>>;

async function getUserIdByEmail(email: string) {
	const pg = new PgClient({ connectionString: getTestDatabaseUrl() });
	await pg.connect();

	try {
		const result = await pg.query<{ id: string }>(
			`select id from "user" where email = $1 limit 1`,
			[email],
		);
		const row = result.rows[0];
		if (!row) {
			throw new Error(`Failed to find user '${email}'`);
		}

		return row.id;
	} finally {
		await pg.end();
	}
}

export async function createTestUser() {
	const password = "password123";
	const baseUrl = getBackendUrl();
	const email = `test-${dayjs().valueOf()}@example.com`;

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
		body: JSON.stringify({ email, password }),
		headers: { "Content-Type": "application/json" },
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
	const userId = await getUserIdByEmail(email);
	return { client, cookies, email, password, userId };
}
