import { randomUUID } from "node:crypto";

import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	ADMIN_TOKEN,
	adminAccessTokenHeaders,
	createAuthenticatedClient,
	createApiKey,
	createTestAuthClient,
	createTestUser,
	findBuiltinWorkspaceBySlug,
	getBackendClient,
	signInWithPassword,
	updatePluginWorkspaceState,
} from "~/fixtures";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const WRONG_TOKEN = "wrong-token";
const godModeListQuery = (search?: string) => ({
	limit: 50,
	offset: 0,
	...(search ? { search } : {}),
});
const workspaceListQuery = { includeDisabled: false };
const unique = () => randomUUID();

const getUserIdByEmail = (email: string) =>
	Effect.gen(function* () {
		const data = yield* getBackendClient().call(
			(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		const user = data.users[0];
		assertPresent(user, "missing user row");
		return UserId.make(user.id);
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
				client.call((c) => c.godMode.resetUser({ params: { userId: UserId.make("any-id") } })),
			);
			assertTaggedError(error, "Unauthorized");
		}),
	);

	it.live("rejects resetUser with wrong admin token", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const error = yield* Effect.flip(
				client.call(
					(c) => c.godMode.resetUser({ params: { userId: UserId.make("any-id") } }),
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
					(c) => c.godMode.resetUser({ params: { userId: UserId.make(`missing-${unique()}`) } }),
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
			yield* client.call((c) => c.definitions.listWorkspaces({ query: workspaceListQuery }), {
				Cookie: cookies,
			});
			yield* client.call((c) => c.definitions.listWorkspaces({ query: workspaceListQuery }), {
				"X-Api-Key": apiKey,
			});

			const workspace = yield* findBuiltinWorkspaceBySlug(userClient, "media");
			const configuredWorkspace = yield* updatePluginWorkspaceState(userClient, workspace.slug, {
				config: { fixture: true },
			});
			expect(configuredWorkspace.config).toEqual({ fixture: true });

			const resetData = yield* client.call(
				(c) => c.godMode.resetUser({ params: { userId } }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(resetData.userId).toBe(userId);
			expect(resetData.email).toBe(email);
			assertPresent(resetData.resetUrl, "expected a reset url for a credential user");
			expect(resetData.resetUrl).toMatch(/\/reset-password\?token=.+/);

			const oldSession = yield* Effect.flip(
				client.call((c) => c.definitions.listWorkspaces({ query: workspaceListQuery }), {
					Cookie: cookies,
				}),
			);
			assertTaggedError(oldSession, "Unauthorized");

			const oldApiKey = yield* Effect.flip(
				client.call((c) => c.definitions.listWorkspaces({ query: workspaceListQuery }), {
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
			expect(signInRes.error).toBeNull();
			assertPresent(signInRes.cookies, "expected cookies after sign-in");

			const workspaces = yield* client.call(
				(c) => c.definitions.listWorkspaces({ query: { includeDisabled: true } }),
				{ Cookie: signInRes.cookies },
			);
			expect(workspaces.some((candidate) => candidate.slug === "media")).toBe(true);
			const resetWorkspace = workspaces.find((candidate) => candidate.slug === workspace.slug);
			assertPresent(resetWorkspace, "expected the installed plugin workspace after reset");
			expect(resetWorkspace.config).toEqual({});
		}),
	);
});

describe("Reset user for no-account user", () => {
	it.live("returns a working reset link and lands the user in a credential state", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const { email, userId } = yield* createNoAccountUser("ResetNone");

			const resetData = yield* client.call(
				(c) => c.godMode.resetUser({ params: { userId } }),
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
			expect(signInRes.error).toBeNull();

			const listData = yield* client.call(
				(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
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
				(c) => c.godMode.resetUser({ params: { userId } }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(resetData.email).toBe(email);
			expect(resetData.resetUrl).toBeNull();

			const listData = yield* client.call(
				(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
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
					(c) => c.godMode.resetUser({ params: { userId } }),
					adminAccessTokenHeaders(ADMIN_TOKEN),
				),
			);
			assertTaggedError(error, "BadRequest");
			expect(error.message).toMatch(/mixed/i);

			// The reset is rejected before any mutation, so the pre-existing session keeps working.
			yield* client.call((c) => c.definitions.listWorkspaces({ query: workspaceListQuery }), {
				Cookie: cookies,
			});
		}),
	);
});
