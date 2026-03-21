import { randomUUID } from "node:crypto";

import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	ADMIN_TOKEN,
	adminAccessTokenHeaders,
	getBackendClient,
	createAuthenticatedClient,
	createTestAuthClient,
	createTestUser,
	cookieHeaderFromSetCookies,
	createTracker,
} from "~/fixtures";
import { assertPresent, assertTaggedError, requireNonEmptyArray } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

const WRONG_TOKEN = "wrong-token";
const godModeListQuery = (search?: string) => ({
	limit: 50,
	offset: 0,
	...(search ? { search } : {}),
});
const trackersListQuery = { includeDisabled: false };
const unique = () => randomUUID();

const getUserIdByEmail = (email: string) =>
	Effect.gen(function* () {
		const data = yield* getBackendClient().call(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		const user = data.users[0];
		assertPresent(user, "missing user row");
		return UserId.make(user.id);
	});

const signInWithPassword = (email: string, password: string) =>
	Effect.promise(() =>
		fetch(`${getBackendUrl()}/auth/sign-in/email`, {
			method: "POST",
			body: JSON.stringify({ email, password }),
			headers: { "Content-Type": "application/json" },
		}),
	);

const createApiKey = (cookies: string) =>
	Effect.gen(function* () {
		const response = yield* Effect.promise(() =>
			fetch(`${getBackendUrl()}/auth/api-key/create`, {
				method: "POST",
				body: JSON.stringify({ name: "E2E key" }),
				headers: { Cookie: cookies, "Content-Type": "application/json" },
			}),
		);
		if (!response.ok) {
			const error = yield* Effect.promise(() => response.text());
			throw new Error(`API key creation failed: ${error}`);
		}
		const data: { key: string } = yield* Effect.promise(() => response.json());
		return data.key;
	});

const createNoAccountUser = (name: string) =>
	Effect.gen(function* () {
		const email = `${name.toLowerCase()}-${unique()}@example.com`;
		const { userId } = yield* getBackendClient().call(
			(c) => c.godMode.provisionUser({ payload: { provider: "credential", email, name } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		return { email, userId: UserId.make(userId) };
	});

const createOidcUser = (name: string) =>
	Effect.gen(function* () {
		const email = `${name.toLowerCase()}-${unique()}@example.com`;
		const { userId } = yield* getBackendClient().call(
			(c) =>
				c.godMode.provisionUser({
					payload: { name, email, provider: "oidc", oidcIssuerId: `oidc-sub-${unique()}` },
				}),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		return { email, userId: UserId.make(userId) };
	});

describe("Reset user admin token enforcement", () => {
	it.live("rejects resetUser without auth header", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const error = yield* Effect.flip(
				client.call((c) => c.godMode.resetUser({ path: { userId: UserId.make("any-id") } })),
			);
			assertTaggedError(error, "Unauthorized");
		}),
	);

	it.live("rejects resetUser with wrong admin token", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const error = yield* Effect.flip(
				client.call(
					(c) => c.godMode.resetUser({ path: { userId: UserId.make("any-id") } }),
					adminAccessTokenHeaders(WRONG_TOKEN),
				),
			);
			assertTaggedError(error, "Unauthorized");
		}),
	);

	it.live("rejects resetUser for a non-existent user", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const error = yield* Effect.flip(
				client.call(
					(c) => c.godMode.resetUser({ path: { userId: UserId.make(`missing-${unique()}`) } }),
					adminAccessTokenHeaders(ADMIN_TOKEN),
				),
			);
			assertTaggedError(error, "BadRequest");
		}),
	);
});

describe("Reset user for credential user", () => {
	it.live("wipes data, kills old session and api key, and rebuilds baseline", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const {
				email,
				cookies,
				userId: rawUserId,
				client: userClient,
			} = yield* createAuthenticatedClient();
			const userId = UserId.make(rawUserId);
			const apiKey = yield* createApiKey(cookies);

			// Both auth methods work before the reset.
			yield* client.call((c) => c.trackers.list({ urlParams: trackersListQuery }), {
				Cookie: cookies,
			});
			yield* client.call((c) => c.trackers.list({ urlParams: trackersListQuery }), {
				"X-Api-Key": apiKey,
			});

			const { tracker } = yield* createTracker(userClient, { name: "Custom Reset Tracker" });
			expect(tracker.isBuiltin).toBe(false);

			const resetData = yield* client.call(
				(c) => c.godMode.resetUser({ path: { userId } }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(resetData.userId).toBe(userId);
			expect(resetData.email).toBe(email);
			assertPresent(resetData.resetUrl, "expected a reset url for a credential user");
			expect(resetData.resetUrl).toMatch(/\/reset-password\?token=.+/);

			const oldSession = yield* Effect.flip(
				client.call((c) => c.trackers.list({ urlParams: trackersListQuery }), { Cookie: cookies }),
			);
			assertTaggedError(oldSession, "Unauthorized");

			const oldApiKey = yield* Effect.flip(
				client.call((c) => c.trackers.list({ urlParams: trackersListQuery }), {
					"X-Api-Key": apiKey,
				}),
			);
			assertTaggedError(oldApiKey, "Unauthorized");

			const token = new URL(resetData.resetUrl).searchParams.get("token");
			assertPresent(token, "missing token");
			const newPassword = "reset-user-pw-123!";
			const { error: resetError } = yield* Effect.promise(() =>
				createTestAuthClient().resetPassword({
					token,
					newPassword,
				}),
			);
			expect(resetError).toBeNull();

			const signInRes = yield* signInWithPassword(email, newPassword);
			expect(signInRes.ok).toBe(true);
			const newCookies = cookieHeaderFromSetCookies(
				requireNonEmptyArray(signInRes.headers.getSetCookie(), "expected cookies after sign-in"),
			);

			const trackers = yield* client.call(
				(c) => c.trackers.list({ urlParams: { includeDisabled: true } }),
				{ Cookie: newCookies },
			);
			expect(trackers.some((t) => t.isBuiltin)).toBe(true);
			expect(trackers.some((t) => t.id === tracker.id)).toBe(false);
		}),
	);
});

describe("Reset user for no-account user", () => {
	it.live("returns a working reset link and lands the user in a credential state", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const { email, userId } = yield* createNoAccountUser("ResetNone");

			const resetData = yield* client.call(
				(c) => c.godMode.resetUser({ path: { userId } }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(resetData.email).toBe(email);
			assertPresent(resetData.resetUrl, "expected a reset url for a no-account user");

			const token = new URL(resetData.resetUrl).searchParams.get("token");
			assertPresent(token, "missing token");
			const newPassword = "reset-none-pw-123!";
			const { error: resetError } = yield* Effect.promise(() =>
				createTestAuthClient().resetPassword({
					token,
					newPassword,
				}),
			);
			expect(resetError).toBeNull();

			const signInRes = yield* signInWithPassword(email, newPassword);
			expect(signInRes.ok).toBe(true);

			const listData = yield* client.call(
				(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(listData.users[0]?.authState).toBe("credential");
		}),
	);
});

describe("Reset user for OIDC user", () => {
	it.live("returns a null reset url and preserves the oidc auth state", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const { email, userId } = yield* createOidcUser("ResetOidc");

			const resetData = yield* client.call(
				(c) => c.godMode.resetUser({ path: { userId } }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(resetData.email).toBe(email);
			expect(resetData.resetUrl).toBeNull();

			const listData = yield* client.call(
				(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(listData.users[0]?.authState).toBe("oidc");
		}),
	);
});

describe("Reset user for mixed-auth user", () => {
	it.live("rejects the reset and leaves the existing session intact", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const { cookies, email } = yield* createTestUser();
			const userId = yield* getUserIdByEmail(email);

			yield* client.call(
				(c) =>
					c.testSupport.linkAuthAccount({
						payload: {
							userId,
							providerId: "oidc",
							accountId: `oidc-sub-${unique()}`,
						},
					}),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);

			const error = yield* Effect.flip(
				client.call(
					(c) => c.godMode.resetUser({ path: { userId } }),
					adminAccessTokenHeaders(ADMIN_TOKEN),
				),
			);
			assertTaggedError(error, "BadRequest");
			expect(error.message).toMatch(/mixed/i);

			// The reset is rejected before any mutation, so the pre-existing session keeps working.
			yield* client.call((c) => c.trackers.list({ urlParams: trackersListQuery }), {
				Cookie: cookies,
			});
		}),
	);
});
