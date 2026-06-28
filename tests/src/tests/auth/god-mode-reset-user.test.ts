import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

import { UserId } from "@ryot/contract/schema/brands";

import { getBackendClient } from "~/fixtures";
import { createAuthenticatedClient, createTestAuthClient, createTestUser } from "~/fixtures/auth";
import { cookieHeaderFromSetCookies } from "~/fixtures/auth-2fa";
import { createTracker } from "~/fixtures/trackers";
import { getBackendUrl, getPgClient } from "~/setup";
import { assertPresent, assertTaggedError, requireNonEmptyArray } from "~/support/assertions";

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
const unique = () => randomUUID();

async function getUserIdByEmail(email: string) {
	const data = await getBackendClient().run(
		(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
		adminAccessTokenHeaders(ADMIN_TOKEN),
	);
	const user = data.users[0];
	assertPresent(user, "missing user row");
	return UserId.make(user.id);
}

async function signInWithPassword(email: string, password: string) {
	return await fetch(`${getBackendUrl()}/auth/sign-in/email`, {
		method: "POST",
		body: JSON.stringify({ email, password }),
		headers: { "Content-Type": "application/json" },
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
	const email = `${name.toLowerCase()}-${unique()}@example.com`;
	const { userId } = await getBackendClient().run(
		(c) => c.godMode.provisionUser({ payload: { provider: "credential", email, name } }),
		adminAccessTokenHeaders(ADMIN_TOKEN),
	);
	return { email, userId: UserId.make(userId) };
}

async function createOidcUser(name: string) {
	const email = `${name.toLowerCase()}-${unique()}@example.com`;
	const { userId } = await getBackendClient().run(
		(c) =>
			c.godMode.provisionUser({
				payload: { name, email, provider: "oidc", oidcIssuerId: `oidc-sub-${unique()}` },
			}),
		adminAccessTokenHeaders(ADMIN_TOKEN),
	);
	return { email, userId: UserId.make(userId) };
}

describe("Reset user admin token enforcement", () => {
	it("rejects resetUser without auth header", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.godMode.resetUser({ path: { userId: UserId.make("any-id") } }),
		);
		assertTaggedError(error, "Unauthorized");
	});

	it("rejects resetUser with wrong admin token", async () => {
		const client = getBackendClient();
		const error = await client.runError(
			(c) => c.godMode.resetUser({ path: { userId: UserId.make("any-id") } }),
			adminAccessTokenHeaders(WRONG_TOKEN),
		);
		assertTaggedError(error, "Unauthorized");
	});

	it("rejects resetUser for a non-existent user", async () => {
		const client = getBackendClient();
		const error = await client.runError(
			(c) => c.godMode.resetUser({ path: { userId: UserId.make(`missing-${unique()}`) } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		assertTaggedError(error, "BadRequest");
	});
});

describe("Reset user for credential user", () => {
	it("wipes data, kills old session and api key, and rebuilds baseline", async () => {
		const client = getBackendClient();
		const {
			email,
			cookies,
			userId: rawUserId,
			client: userClient,
		} = await createAuthenticatedClient();
		const userId = UserId.make(rawUserId);
		const apiKey = await createApiKey(cookies);

		// Both auth methods work before the reset.
		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), { Cookie: cookies });
		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			"X-Api-Key": apiKey,
		});

		const { tracker } = await createTracker(userClient, { name: "Custom Reset Tracker" });
		expect(tracker.isBuiltin).toBe(false);

		const resetData = await client.run(
			(c) => c.godMode.resetUser({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(resetData.userId).toBe(userId);
		expect(resetData.email).toBe(email);
		assertPresent(resetData.resetUrl, "expected a reset url for a credential user");
		expect(resetData.resetUrl).toMatch(/\/reset-password\?token=.+/);

		const oldSession = await client.runError(
			(c) => c.trackers.list({ urlParams: trackersListQuery }),
			{ Cookie: cookies },
		);
		assertTaggedError(oldSession, "Unauthorized");

		const oldApiKey = await client.runError(
			(c) => c.trackers.list({ urlParams: trackersListQuery }),
			{ "X-Api-Key": apiKey },
		);
		assertTaggedError(oldApiKey, "Unauthorized");

		const token = new URL(resetData.resetUrl).searchParams.get("token");
		assertPresent(token, "missing token");
		const newPassword = "reset-user-pw-123!";
		const { error: resetError } = await createTestAuthClient().resetPassword({
			token,
			newPassword,
		});
		expect(resetError).toBeNull();

		const signInRes = await signInWithPassword(email, newPassword);
		expect(signInRes.ok).toBe(true);
		const newCookies = cookieHeaderFromSetCookies(
			requireNonEmptyArray(signInRes.headers.getSetCookie(), "expected cookies after sign-in"),
		);

		const trackers = await client.run(
			(c) => c.trackers.list({ urlParams: { includeDisabled: true } }),
			{ Cookie: newCookies },
		);
		expect(trackers.some((t) => t.isBuiltin)).toBe(true);
		expect(trackers.some((t) => t.id === tracker.id)).toBe(false);
	});
});

describe("Reset user for no-account user", () => {
	it("returns a working reset link and lands the user in a credential state", async () => {
		const client = getBackendClient();
		const { email, userId } = await createNoAccountUser("ResetNone");

		const resetData = await client.run(
			(c) => c.godMode.resetUser({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(resetData.email).toBe(email);
		assertPresent(resetData.resetUrl, "expected a reset url for a no-account user");

		const token = new URL(resetData.resetUrl).searchParams.get("token");
		assertPresent(token, "missing token");
		const newPassword = "reset-none-pw-123!";
		const { error: resetError } = await createTestAuthClient().resetPassword({
			token,
			newPassword,
		});
		expect(resetError).toBeNull();

		const signInRes = await signInWithPassword(email, newPassword);
		expect(signInRes.ok).toBe(true);

		const listData = await client.run(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(listData.users[0]?.authState).toBe("credential");
	});
});

describe("Reset user for OIDC user", () => {
	it("returns a null reset url and preserves the oidc auth state", async () => {
		const client = getBackendClient();
		const { email, userId } = await createOidcUser("ResetOidc");

		const resetData = await client.run(
			(c) => c.godMode.resetUser({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(resetData.email).toBe(email);
		expect(resetData.resetUrl).toBeNull();

		const listData = await client.run(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(listData.users[0]?.authState).toBe("oidc");
	});
});

describe("Reset user for mixed-auth user", () => {
	it("rejects the reset and leaves the existing session intact", async () => {
		const client = getBackendClient();
		const { cookies, email } = await createTestUser();
		const userId = await getUserIdByEmail(email);

		await getPgClient().query(
			`INSERT INTO "account" (id, account_id, provider_id, user_id, created_at, updated_at)
			 VALUES ($1, $2, 'oidc', $3, NOW(), NOW())`,
			[randomUUID(), `oidc-sub-${unique()}`, userId],
		);

		const error = await client.runError(
			(c) => c.godMode.resetUser({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		assertTaggedError(error, "BadRequest");
		expect(error.message).toMatch(/mixed/i);

		// The reset is rejected before any mutation, so the pre-existing session keeps working.
		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), { Cookie: cookies });
	});
});
