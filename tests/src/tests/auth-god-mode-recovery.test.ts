import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

import { UserId } from "@ryot/app-backend/schema/brands";
import { DateTime } from "effect";

import { getBackendClient } from "../fixtures";
import { createTestAuthClient, createTestUser } from "../fixtures/auth";
import { cookieHeaderFromSetCookies } from "../fixtures/auth-2fa";
import { getBackendUrl, getPgClient } from "../setup";
import { assertTaggedError, requireNonEmptyArray } from "../test-support/assertions";

const WRONG_TOKEN = "wrong-token";
const ADMIN_TOKEN = "test-admin-token";
const ADMIN_ACCESS_TOKEN_HEADER = "Admin-Access-Token";

const adminAccessTokenHeaders = (token: string) => ({ [ADMIN_ACCESS_TOKEN_HEADER]: token });
const godModeListQuery = (search?: string) => ({
	limit: 50,
	offset: 0,
	...(search ? { search } : {}),
});
const trackersListQuery = { includeDisabled: false };
const uniqueTimestamp = () => DateTime.toEpochMillis(DateTime.unsafeNow());

async function getUserIdByEmail(email: string) {
	const result = await getPgClient().query<{ id: string }>(
		`SELECT id FROM "user" WHERE email = $1`,
		[email],
	);
	const row = result.rows[0];
	if (!row) {
		throw new Error("missing user row");
	}
	return UserId.make(row.id);
}

async function signInWithPassword(email: string, password: string) {
	return await fetch(`${getBackendUrl()}/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
}

async function createApiKey(cookies: string) {
	const response = await fetch(`${getBackendUrl()}/auth/api-key/create`, {
		method: "POST",
		body: JSON.stringify({ name: "E2E key" }),
		headers: { Cookie: cookies, "Content-Type": "application/json" },
	});
	if (!response.ok) {
		throw new Error(`API key creation failed: ${await response.text()}`);
	}
	const data: { key: string } = await response.json();
	return data.key;
}

async function createNoAccountUser(name: string) {
	const userId = randomUUID();
	const email = `${name.toLowerCase()}-${uniqueTimestamp()}@example.com`;
	await getPgClient().query(
		`INSERT INTO "user" (id, name, email, email_verified, preferences, created_at, updated_at)
		 VALUES ($1, $2, $3, true, '{}', NOW(), NOW())`,
		[userId, name, email],
	);
	return { email, userId: UserId.make(userId) };
}

async function createOidcUser(name: string) {
	const pg = getPgClient();
	const userId = randomUUID();
	const email = `${name.toLowerCase()}-${uniqueTimestamp()}@example.com`;
	await pg.query(
		`INSERT INTO "user" (id, name, email, email_verified, preferences, created_at, updated_at)
		 VALUES ($1, $2, $3, true, '{}', NOW(), NOW())`,
		[userId, name, email],
	);
	await pg.query(
		`INSERT INTO "account" (id, account_id, provider_id, user_id, created_at, updated_at)
		 VALUES ($1, $2, 'oidc', $3, NOW(), NOW())`,
		[randomUUID(), `oidc-sub-${uniqueTimestamp()}`, userId],
	);
	return { email, userId: UserId.make(userId) };
}

describe("God-mode admin token enforcement", () => {
	it("rejects user listing without auth header", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.godMode.listUsers({ urlParams: godModeListQuery() }),
		);
		assertTaggedError(error, "Unauthorized");
	});

	it("rejects user listing with wrong admin token", async () => {
		const client = getBackendClient();
		const error = await client.runError(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery() }),
			adminAccessTokenHeaders(WRONG_TOKEN),
		);
		assertTaggedError(error, "Unauthorized");
	});

	it("rejects reset generation without auth header", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.godMode.resetUserPassword({ path: { userId: UserId.make("any-id") } }),
		);
		assertTaggedError(error, "Unauthorized");
	});

	it("rejects reset generation with wrong admin token", async () => {
		const client = getBackendClient();
		const error = await client.runError(
			(c) => c.godMode.resetUserPassword({ path: { userId: UserId.make("any-id") } }),
			adminAccessTokenHeaders(WRONG_TOKEN),
		);
		assertTaggedError(error, "Unauthorized");
	});

	it("rejects ban set without auth header", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.godMode.setUserBan({ payload: { banned: true }, path: { userId: UserId.make("any-id") } }),
		);
		assertTaggedError(error, "Unauthorized");
	});

	it("rejects ban set with wrong admin token", async () => {
		const client = getBackendClient();
		const error = await client.runError(
			(c) =>
				c.godMode.setUserBan({
					payload: { banned: true },
					path: { userId: UserId.make("any-id") },
				}),
			adminAccessTokenHeaders(WRONG_TOKEN),
		);
		assertTaggedError(error, "Unauthorized");
	});
});

describe("User listing with correct admin token", () => {
	it("classifies no-account users as 'none'", async () => {
		const client = getBackendClient();
		const { email } = await createNoAccountUser("NoneUser");

		const data = await client.run(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		const user = data.users[0];
		expect(user?.authState).toBe("none");
		expect(user?.email).toBe(email);
	});

	it("classifies OIDC-only users as 'oidc'", async () => {
		const client = getBackendClient();
		const { email } = await createOidcUser("ListOidcUser");

		const data = await client.run(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(data.users[0]?.authState).toBe("oidc");
	});

	it("classifies credential users as 'credential'", async () => {
		const client = getBackendClient();
		const { email } = await createTestUser();

		const data = await client.run(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(data.users[0]?.authState).toBe("credential");
		expect(data.users[0]?.bannedAt).toBeNull();
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

		await getPgClient().query(
			`INSERT INTO "account" (id, account_id, provider_id, user_id, created_at, updated_at)
			 VALUES ($1, $2, 'oidc', $3, NOW(), NOW())`,
			[randomUUID(), `oidc-sub-${uniqueTimestamp()}`, userId],
		);

		const data = await client.run(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(data.users[0]?.authState).toBe("mixed");
	});
});

describe("User provisioning", () => {
	it("provisions a credential user with no linked account", async () => {
		const client = getBackendClient();
		const email = `provision-cred-${uniqueTimestamp()}@example.com`;

		await client.run(
			(c) =>
				c.godMode.provisionUser({
					payload: { provider: "credential", email, name: "Provisioned Credential" },
				}),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);

		const listData = await client.run(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(listData.users[0]?.authState).toBe("none");
	});

	it("provisions an oidc user with a linked account", async () => {
		const client = getBackendClient();
		const email = `provision-oidc-${uniqueTimestamp()}@example.com`;

		await client.run(
			(c) =>
				c.godMode.provisionUser({
					payload: {
						email,
						provider: "oidc",
						name: "Provisioned Oidc",
						oidcIssuerId: `oidc-sub-${uniqueTimestamp()}`,
					},
				}),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);

		const listData = await client.run(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(listData.users[0]?.authState).toBe("oidc");
	});

	it("rejects provisioning a user whose email already exists", async () => {
		const client = getBackendClient();
		const { email } = await createTestUser();

		const error = await client.runError(
			(c) =>
				c.godMode.provisionUser({
					payload: { provider: "credential", email, name: "Duplicate" },
				}),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		assertTaggedError(error, "BadRequest");
	});
});

describe("God-mode ban set", () => {
	it("disables a user, revokes sessions, blocks API keys, and then enables the user", async () => {
		const client = getBackendClient();
		const { cookies, email, password } = await createTestUser();
		const userId = await getUserIdByEmail(email);
		const apiKey = await createApiKey(cookies);

		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			Cookie: cookies,
		});

		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			"X-Api-Key": apiKey,
		});

		const banData = await client.run(
			(c) => c.godMode.setUserBan({ payload: { banned: true }, path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(typeof banData.bannedAt).toBe("string");

		const listData = await client.run(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(listData.users[0]?.bannedAt).toBe(banData.bannedAt);

		const revokedSession = await client.runError(
			(c) => c.trackers.list({ urlParams: trackersListQuery }),
			{ Cookie: cookies },
		);
		assertTaggedError(revokedSession, "Unauthorized");

		const blockedApiKey = await client.runError(
			(c) => c.trackers.list({ urlParams: trackersListQuery }),
			{ "X-Api-Key": apiKey },
		);
		assertTaggedError(blockedApiKey, "Unauthorized");

		const blockedSignIn = await signInWithPassword(email, password);
		expect(blockedSignIn.status).toBe(403);

		const enableData = await client.run(
			(c) => c.godMode.setUserBan({ payload: { banned: false }, path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(enableData.bannedAt).toBeNull();

		const restoredSignIn = await signInWithPassword(email, password);
		expect(restoredSignIn.ok).toBe(true);
	});
});

describe("Reset link generation and completion for credential user", () => {
	it("generates reset link, sets new password, and signs in", async () => {
		const client = getBackendClient();
		const { email } = await createTestUser();

		const userId = await getUserIdByEmail(email);

		const resetData = await client.run(
			(c) => c.godMode.resetUserPassword({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(resetData.email).toBe(email);
		expect(typeof resetData.resetUrl).toBe("string");
		expect(resetData.resetUrl).toMatch(/\/reset-password\?token=.+/);

		const token = new URL(resetData.resetUrl).searchParams.get("token");
		expect(typeof token).toBe("string");
		if (!token) {
			throw new Error("missing token");
		}

		const newPassword = "new-password-456!";
		const { error: resetError } = await createTestAuthClient().resetPassword({
			token,
			newPassword,
		});
		expect(resetError).toBeNull();

		const signInRes = await signInWithPassword(email, newPassword);
		expect(signInRes.ok).toBe(true);

		const signInData = await signInRes.json();
		expect(signInData.twoFactorRedirect).toBeUndefined();

		const setCookies = signInRes.headers.getSetCookie();
		const cookies = cookieHeaderFromSetCookies(
			requireNonEmptyArray(setCookies, "Expected session cookies after sign-in"),
		);
		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			Cookie: cookies,
		});
	});

	it("revokes sessions after password reset", async () => {
		const client = getBackendClient();
		const { cookies, email } = await createTestUser();

		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			Cookie: cookies,
		});

		const userId = await getUserIdByEmail(email);

		const resetData = await client.run(
			(c) => c.godMode.resetUserPassword({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		const token = new URL(resetData.resetUrl).searchParams.get("token");
		expect(typeof token).toBe("string");
		if (!token) {
			throw new Error("missing token");
		}

		const newPassword = "revoked-session-pw!";
		const { error: resetError } = await createTestAuthClient().resetPassword({
			token,
			newPassword,
		});
		expect(resetError).toBeNull();

		const oldSessionError = await client.runError(
			(c) => c.trackers.list({ urlParams: trackersListQuery }),
			{ Cookie: cookies },
		);
		assertTaggedError(oldSessionError, "Unauthorized");

		const signInRes = await signInWithPassword(email, newPassword);
		expect(signInRes.ok).toBe(true);

		const newSetCookies = signInRes.headers.getSetCookie();
		const newCookies = cookieHeaderFromSetCookies(
			requireNonEmptyArray(newSetCookies, "Expected session cookies after re-sign-in"),
		);
		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			Cookie: newCookies,
		});
	});
});

describe("Reset link generation and completion for no-account user", () => {
	it("generates reset link, creates credential account, and signs in", async () => {
		const client = getBackendClient();
		const { email, userId } = await createNoAccountUser("NoneReset");

		const resetData = await client.run(
			(c) => c.godMode.resetUserPassword({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(resetData.email).toBe(email);
		const token = new URL(resetData.resetUrl).searchParams.get("token");
		expect(typeof token).toBe("string");
		if (!token) {
			throw new Error("missing token");
		}

		const newPassword = "none-state-password-456!";
		const { error: resetError } = await createTestAuthClient().resetPassword({
			token,
			newPassword,
		});
		expect(resetError).toBeNull();

		const signInRes = await signInWithPassword(email, newPassword);
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

		const error = await client.runError(
			(c) => c.godMode.resetUserPassword({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		assertTaggedError(error, "BadRequest");
		expect(error.message).toMatch(/oidc/i);
	});
});

describe("Mixed auth user restrictions", () => {
	it("rejects password reset for mixed auth users", async () => {
		const client = getBackendClient();
		const { email } = await createTestUser();

		const userId = await getUserIdByEmail(email);

		await getPgClient().query(
			`INSERT INTO "account" (id, account_id, provider_id, user_id, created_at, updated_at)
			 VALUES ($1, $2, 'oidc', $3, NOW(), NOW())`,
			[randomUUID(), `oidc-sub-${uniqueTimestamp()}`, userId],
		);

		const error = await client.runError(
			(c) => c.godMode.resetUserPassword({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		assertTaggedError(error, "BadRequest");
		expect(error.message).toMatch(/mixed/i);
	});
});
