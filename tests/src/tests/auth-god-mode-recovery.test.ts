import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

import { dayjs } from "@ryot/ts-utils/dayjs";

import { createTestAuthClient, createTestUser } from "../fixtures/auth";
import { cookieHeaderFromSetCookies } from "../fixtures/auth-2fa";
import { getBackendClient, getBackendUrl, getPgClient } from "../setup";
import { requireNonEmptyArray } from "../test-support/assertions";

const WRONG_TOKEN = "wrong-token";
const ADMIN_TOKEN = "test-admin-token";

async function createNoAccountUser(name: string) {
	const userId = randomUUID();
	const email = `${name.toLowerCase()}-${dayjs().valueOf()}@example.com`;
	await getPgClient().query(
		`INSERT INTO "user" (id, name, email, email_verified, preferences, created_at, updated_at)
		 VALUES ($1, $2, $3, true, '{}', NOW(), NOW())`,
		[userId, name, email],
	);
	return { email, userId };
}

async function createOidcUser(name: string) {
	const pg = getPgClient();
	const userId = randomUUID();
	const email = `${name.toLowerCase()}-${dayjs().valueOf()}@example.com`;
	await pg.query(
		`INSERT INTO "user" (id, name, email, email_verified, preferences, created_at, updated_at)
		 VALUES ($1, $2, $3, true, '{}', NOW(), NOW())`,
		[userId, name, email],
	);
	await pg.query(
		`INSERT INTO "account" (id, account_id, provider_id, user_id, created_at, updated_at)
		 VALUES ($1, $2, 'oidc', $3, NOW(), NOW())`,
		[randomUUID(), `oidc-sub-${dayjs().valueOf()}`, userId],
	);
	return { email, userId };
}

describe("God-mode admin token enforcement", () => {
	it("rejects user listing without auth header", async () => {
		const client = getBackendClient();
		const { response } = await client.GET("/god-mode/users");
		expect(response.status).toBe(401);
	});

	it("rejects user listing with wrong bearer token", async () => {
		const client = getBackendClient();
		const { response } = await client.GET("/god-mode/users", {
			headers: { Authorization: `Bearer ${WRONG_TOKEN}` },
		});
		expect(response.status).toBe(401);
	});

	it("rejects reset generation without auth header", async () => {
		const client = getBackendClient();
		const { response } = await client.POST("/god-mode/users/{userId}/reset-password", {
			params: { path: { userId: "any-id" } },
		});
		expect(response.status).toBe(401);
	});

	it("rejects reset generation with wrong bearer token", async () => {
		const client = getBackendClient();
		const { response } = await client.POST("/god-mode/users/{userId}/reset-password", {
			params: { path: { userId: "any-id" } },
			headers: { Authorization: `Bearer ${WRONG_TOKEN}` },
		});
		expect(response.status).toBe(401);
	});
});

describe("User listing with correct admin token", () => {
	it("classifies no-account users as 'none'", async () => {
		const client = getBackendClient();
		const { email } = await createNoAccountUser("NoneUser");

		const { data, response } = await client.GET("/god-mode/users", {
			params: { query: { search: email } },
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(200);
		const user = data?.data.users[0];
		expect(user?.authState).toBe("none");
		expect(user?.email).toBe(email);
	});

	it("classifies OIDC-only users as 'oidc'", async () => {
		const client = getBackendClient();
		const { email } = await createOidcUser("ListOidcUser");

		const { data, response } = await client.GET("/god-mode/users", {
			params: { query: { search: email } },
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(200);
		expect(data?.data.users[0]?.authState).toBe("oidc");
	});

	it("classifies credential users as 'credential'", async () => {
		const client = getBackendClient();
		const { email } = await createTestUser();

		const { data, response } = await client.GET("/god-mode/users", {
			params: { query: { search: email } },
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(200);
		expect(data?.data.users[0]?.authState).toBe("credential");
	});

	it("classifies mixed auth users as 'mixed'", async () => {
		const client = getBackendClient();
		const { email } = await createTestUser();

		const pg = getPgClient();
		const result = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			email,
		]);
		const row = result.rows[0];
		if (!row) {
			throw new Error("missing user row");
		}
		const userId = row.id;

		await pg.query(
			`INSERT INTO "account" (id, account_id, provider_id, user_id, created_at, updated_at)
			 VALUES ($1, $2, 'oidc', $3, NOW(), NOW())`,
			[randomUUID(), `oidc-sub-${dayjs().valueOf()}`, userId],
		);

		const { data, response } = await client.GET("/god-mode/users", {
			params: { query: { search: email } },
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(200);
		expect(data?.data.users[0]?.authState).toBe("mixed");
	});
});

describe("Reset link generation and completion for credential user", () => {
	it("generates reset link, sets new password, and signs in", async () => {
		const client = getBackendClient();
		const { email } = await createTestUser();

		const pg = getPgClient();
		const result = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			email,
		]);
		const row = result.rows[0];
		if (!row) {
			throw new Error("missing user row");
		}
		const userId = row.id;

		const { data: resetData, response: resetResponse } = await client.POST(
			"/god-mode/users/{userId}/reset-password",
			{
				params: { path: { userId } },
				headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
			},
		);
		expect(resetResponse.status).toBe(200);
		expect(resetData?.data).toBeDefined();
		expect(resetData?.data.email).toBe(email);
		expect(resetData?.data.resetUrl).toBeString();
		expect(resetData?.data.resetUrl).toMatch(/\/reset-password\?token=.+/);

		const token = new URL(resetData?.data.resetUrl ?? "").searchParams.get("token");
		expect(token).toBeString();
		if (!token) {
			throw new Error("missing token");
		}

		const newPassword = "new-password-456!";
		const { error: resetError } = await createTestAuthClient().resetPassword({
			token,
			newPassword,
		});
		expect(resetError).toBeNull();

		const signInRes = await fetch(`${getBackendUrl()}/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password: newPassword }),
		});
		expect(signInRes.ok).toBe(true);

		const signInData = await signInRes.json();
		expect(signInData.twoFactorRedirect).toBeUndefined();

		const setCookies = signInRes.headers.getSetCookie();
		const cookies = cookieHeaderFromSetCookies(
			requireNonEmptyArray(setCookies, "Expected session cookies after sign-in"),
		);
		const { response: trackersRes } = await client.GET("/trackers", {
			headers: { Cookie: cookies },
		});
		expect(trackersRes.status).toBe(200);
	});

	it("revokes sessions after password reset", async () => {
		const client = getBackendClient();
		const { cookies, email } = await createTestUser();

		const { response: trackersBefore } = await client.GET("/trackers", {
			headers: { Cookie: cookies },
		});
		expect(trackersBefore.status).toBe(200);

		const pg = getPgClient();
		const result = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			email,
		]);
		const row = result.rows[0];
		if (!row) {
			throw new Error("missing user row");
		}
		const userId = row.id;

		const { data: resetData, response: resetResponse } = await client.POST(
			"/god-mode/users/{userId}/reset-password",
			{
				params: { path: { userId } },
				headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
			},
		);
		expect(resetResponse.status).toBe(200);
		const token = new URL(resetData?.data.resetUrl ?? "").searchParams.get("token");
		expect(token).toBeString();
		if (!token) {
			throw new Error("missing token");
		}

		const newPassword = "revoked-session-pw!";
		const { error: resetError } = await createTestAuthClient().resetPassword({
			token,
			newPassword,
		});
		expect(resetError).toBeNull();

		const { response: oldSessionRes } = await client.GET("/trackers", {
			headers: { Cookie: cookies },
		});
		expect(oldSessionRes.status).toBe(401);

		const signInRes = await fetch(`${getBackendUrl()}/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password: newPassword }),
		});
		expect(signInRes.ok).toBe(true);

		const newSetCookies = signInRes.headers.getSetCookie();
		const newCookies = cookieHeaderFromSetCookies(
			requireNonEmptyArray(newSetCookies, "Expected session cookies after re-sign-in"),
		);
		const { response: newSessionRes } = await client.GET("/trackers", {
			headers: { Cookie: newCookies },
		});
		expect(newSessionRes.status).toBe(200);
	});
});

describe("Reset link generation and completion for no-account user", () => {
	it("generates reset link, creates credential account, and signs in", async () => {
		const client = getBackendClient();
		const { email, userId } = await createNoAccountUser("NoneReset");

		const { data: resetData, response: resetResponse } = await client.POST(
			"/god-mode/users/{userId}/reset-password",
			{
				params: { path: { userId } },
				headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
			},
		);
		expect(resetResponse.status).toBe(200);
		expect(resetData?.data.email).toBe(email);
		const token = new URL(resetData?.data.resetUrl ?? "").searchParams.get("token");
		expect(token).toBeString();
		if (!token) {
			throw new Error("missing token");
		}

		const newPassword = "none-state-password-456!";
		const { error: resetError } = await createTestAuthClient().resetPassword({
			token,
			newPassword,
		});
		expect(resetError).toBeNull();

		const signInRes = await fetch(`${getBackendUrl()}/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password: newPassword }),
		});
		expect(signInRes.ok).toBe(true);

		const accountResult = await getPgClient().query<{ count: string }>(
			`SELECT count(*) FROM "account" WHERE "user_id" = $1 AND "provider_id" = 'credential'`,
			[userId],
		);
		expect(accountResult.rows[0]?.count).toBe("1");
	});
});

describe("OIDC user restrictions", () => {
	it("rejects password reset for OIDC-only users", async () => {
		const client = getBackendClient();
		const { userId } = await createOidcUser("BlockedOidc");

		const { error, response } = await client.POST("/god-mode/users/{userId}/reset-password", {
			params: { path: { userId } },
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(400);
		expect(error?.error.message).toMatch(/oidc/i);
	});
});

describe("Mixed auth user restrictions", () => {
	it("rejects password reset for mixed auth users", async () => {
		const client = getBackendClient();
		const { email } = await createTestUser();

		const pg = getPgClient();
		const result = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			email,
		]);
		const row = result.rows[0];
		if (!row) {
			throw new Error("missing user row");
		}
		const userId = row.id;

		await pg.query(
			`INSERT INTO "account" (id, account_id, provider_id, user_id, created_at, updated_at)
			 VALUES ($1, $2, 'oidc', $3, NOW(), NOW())`,
			[randomUUID(), `oidc-sub-${dayjs().valueOf()}`, userId],
		);

		const { error, response } = await client.POST("/god-mode/users/{userId}/reset-password", {
			params: { path: { userId } },
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(response.status).toBe(400);
		expect(error?.error.message).toMatch(/mixed/i);
	});
});
