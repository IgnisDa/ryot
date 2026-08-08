import { UserId } from "@ryot-app/contract/schema/brands";
import { godModeUsersRecipe } from "@ryot-app/ryotql-recipes/god-mode";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { DateTime, Effect } from "effect";

import {
	adminAccessTokenHeaders,
	adminHeaders,
	collectRyotQLRecipeItems,
	createApiKey,
	createTestAuthClient,
	createTestUser,
	executeAdminRyotQLRecipe,
	getApiClient,
	makeSession,
	refreshOAuthTokens,
	signInWithPassword,
} from "~/fixtures/kernel";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";

const WRONG_TOKEN = "wrong-token";

const listPluginsWithHeaders = (headers: Record<string, string>) =>
	collectRyotQLRecipeItems(makeSession(undefined, headers), (after) =>
		pluginInstallationsRecipe({ after, limit: 100 }),
	);
const listUsers = (search?: string) =>
	executeAdminRyotQLRecipe(godModeUsersRecipe({ search, limit: 50 }));
const uniqueTimestamp = () => DateTime.toEpochMillis(DateTime.nowUnsafe());

const getUserIdByEmail = (email: string) =>
	Effect.gen(function* () {
		const data = yield* listUsers(email);
		const user = data.items[0];
		assertPresent(user, "missing user row");
		return user.id;
	});

const createNoAccountUser = (name: string) =>
	Effect.gen(function* () {
		const email = `${name.toLowerCase()}-${uniqueTimestamp()}@example.com`;
		const { userId } = yield* getApiClient().call(
			(c) => c.godMode.provisionUser({ payload: { name, email, provider: "credential" } }),
			adminHeaders(),
		);
		return { email, userId: UserId.make(userId) };
	});

const createOidcUser = (name: string) =>
	Effect.gen(function* () {
		const email = `${name.toLowerCase()}-${uniqueTimestamp()}@example.com`;
		const { userId } = yield* getApiClient().call(
			(c) =>
				c.godMode.provisionUser({
					payload: { name, email, provider: "oidc", oidcIssuerId: `oidc-sub-${uniqueTimestamp()}` },
				}),
			adminHeaders(),
		);
		return { email, userId: UserId.make(userId) };
	});

describe("God-mode admin token enforcement", () => {
	it.live("rejects user listing without auth header", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.adminRyotql.execute({ payload: godModeUsersRecipe({ limit: 50 }).document }),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects user listing with wrong admin token", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call(
					(c) => c.adminRyotql.execute({ payload: godModeUsersRecipe({ limit: 50 }).document }),
					adminAccessTokenHeaders(WRONG_TOKEN),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects reset generation without auth header", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.godMode.resetUserPassword({ params: { userId: UserId.make("any-id") } }),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects reset generation with wrong admin token", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call(
					(c) => c.godMode.resetUserPassword({ params: { userId: UserId.make("any-id") } }),
					adminAccessTokenHeaders(WRONG_TOKEN),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects disable set without auth header", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.godMode.setUserDisabled({
						payload: { disabled: true },
						params: { userId: UserId.make("any-id") },
					}),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects disable set with wrong admin token", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call(
					(c) =>
						c.godMode.setUserDisabled({
							payload: { disabled: true },
							params: { userId: UserId.make("any-id") },
						}),
					adminAccessTokenHeaders(WRONG_TOKEN),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);
});

describe("User listing with correct admin token", () => {
	it.live("classifies no-account users as 'none'", () =>
		Effect.gen(function* () {
			const { email } = yield* createNoAccountUser("NoneUser");

			const data = yield* listUsers(email);
			const user = data.items[0];
			expect(user?.authState).toBe("none");
			expect(user?.email).toBe(email);
		}),
	);

	it.live("classifies OIDC-only users as 'oidc'", () =>
		Effect.gen(function* () {
			const { email } = yield* createOidcUser("ListOidcUser");

			const data = yield* listUsers(email);
			expect(data.items[0]?.authState).toBe("oidc");
		}),
	);

	it.live("classifies credential users as 'credential'", () =>
		Effect.gen(function* () {
			const { email } = yield* createTestUser();

			const data = yield* listUsers(email);
			expect(data.items[0]?.authState).toBe("credential");
			expect(data.items[0]?.disabledAt).toBeNull();
		}),
	);

	it.live("classifies mixed auth users as 'mixed'", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { email } = yield* createTestUser();
			const userId = yield* getUserIdByEmail(email);

			yield* client.call(
				(c) =>
					c.testSupport.linkAuthAccount({
						payload: { userId, providerId: "oidc", accountId: `oidc-sub-${uniqueTimestamp()}` },
					}),
				adminHeaders(),
			);

			const data = yield* listUsers(email);
			expect(data.items[0]?.authState).toBe("mixed");
		}),
	);
});

describe("User provisioning", () => {
	it.live("provisions a credential user with no linked account", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const email = `provision-cred-${uniqueTimestamp()}@example.com`;

			yield* client.call(
				(c) =>
					c.godMode.provisionUser({
						payload: { email, provider: "credential", name: "Provisioned Credential" },
					}),
				adminHeaders(),
			);

			const listData = yield* listUsers(email);
			expect(listData.items[0]?.authState).toBe("none");
		}),
	);

	it.live("provisions an oidc user with a linked account", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const email = `provision-oidc-${uniqueTimestamp()}@example.com`;

			yield* client.call(
				(c) =>
					c.godMode.provisionUser({
						payload: {
							email,
							provider: "oidc",
							name: "Provisioned Oidc",
							oidcIssuerId: `oidc-sub-${uniqueTimestamp()}`,
						},
					}),
				adminHeaders(),
			);

			const listData = yield* listUsers(email);
			expect(listData.items[0]?.authState).toBe("oidc");
		}),
	);

	it.live("rejects provisioning a user whose email already exists", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { email } = yield* createTestUser();

			const error = yield* Effect.flip(
				client.call(
					(c) =>
						c.godMode.provisionUser({
							payload: { email, name: "Duplicate", provider: "credential" },
						}),
					adminHeaders(),
				),
			);
			assertTaggedError(error, "GodModeRequestFailure");
			expect(error.reason.code).toBe("user-already-exists");
		}),
	);
});

describe("God-mode disable set", () => {
	it.live("disables a user, revokes sessions, blocks API keys, and then enables the user", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { token, email, password, sessionCookie } = yield* createTestUser();
			const userId = yield* getUserIdByEmail(email);
			const apiKey = yield* createApiKey(sessionCookie);

			yield* listPluginsWithHeaders({ Authorization: `Bearer ${token}` });

			yield* listPluginsWithHeaders({ "X-Api-Key": apiKey });

			const disabledData = yield* client.call(
				(c) => c.godMode.setUserDisabled({ params: { userId }, payload: { disabled: true } }),
				adminHeaders(),
			);
			expect(disabledData).toEqual({ id: userId });

			const listData = yield* listUsers(email);
			expect(typeof listData.items[0]?.disabledAt).toBe("string");

			const revokedSession = yield* Effect.flip(
				listPluginsWithHeaders({ Authorization: `Bearer ${token}` }),
			);
			assertTaggedError(revokedSession, "AuthUnauthorized");

			const blockedApiKey = yield* Effect.flip(listPluginsWithHeaders({ "X-Api-Key": apiKey }));
			assertTaggedError(blockedApiKey, "AuthUnauthorized");

			const blockedSignIn = yield* signInWithPassword(email, password);
			expect(blockedSignIn.error?.status).toBe(403);

			const enableData = yield* client.call(
				(c) => c.godMode.setUserDisabled({ params: { userId }, payload: { disabled: false } }),
				adminHeaders(),
			);
			expect(enableData).toEqual({ id: userId });

			const enabledUsers = yield* listUsers(email);
			expect(enabledUsers.items[0]?.disabledAt).toBeNull();

			const restoredSignIn = yield* signInWithPassword(email, password);
			expect(restoredSignIn.error).toBeNull();
		}),
	);
});

describe("Reset link generation and completion for credential user", () => {
	it.live("generates reset link, sets new password, and signs in", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { email } = yield* createTestUser();

			const userId = yield* getUserIdByEmail(email);

			const resetData = yield* client.call(
				(c) => c.godMode.resetUserPassword({ params: { userId } }),
				adminHeaders(),
			);
			expect(resetData.email).toBe(email);
			expect(typeof resetData.resetUrl).toBe("string");
			expect(resetData.resetUrl).toMatch(/\/reset-password\?token=.+/);

			const token = new URL(resetData.resetUrl).searchParams.get("token");
			expect(typeof token).toBe("string");
			assertPresent(token, "missing token");

			const newPassword = "new-password-456!";
			const { error: resetError } = yield* Effect.promise(() =>
				createTestAuthClient().resetPassword({ token, newPassword }),
			);
			expect(resetError).toBeNull();

			const signInRes = yield* signInWithPassword(email, newPassword);
			expect(signInRes.error).toBeNull();
			assertPresent(signInRes.token, "Expected an auth token after sign-in");
			yield* listPluginsWithHeaders({ Authorization: `Bearer ${signInRes.token}` });
		}),
	);

	it.live("revokes existing credentials after password reset", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { email, refreshToken, token: authToken } = yield* createTestUser();

			yield* listPluginsWithHeaders({ Authorization: `Bearer ${authToken}` });

			const userId = yield* getUserIdByEmail(email);

			const resetData = yield* client.call(
				(c) => c.godMode.resetUserPassword({ params: { userId } }),
				adminHeaders(),
			);
			const token = new URL(resetData.resetUrl).searchParams.get("token");
			expect(typeof token).toBe("string");
			assertPresent(token, "missing token");

			const newPassword = "revoked-session-pw!";
			const { error: resetError } = yield* Effect.promise(() =>
				createTestAuthClient().resetPassword({ token, newPassword }),
			);
			expect(resetError).toBeNull();

			const refreshed = yield* Effect.promise(() => refreshOAuthTokens(getApiUrl(), refreshToken));
			expect(refreshed.status).toBe(400);
			expect(yield* Effect.promise(() => refreshed.json())).toMatchObject({
				error: "invalid_grant",
			});

			const signInRes = yield* signInWithPassword(email, newPassword);
			expect(signInRes.error).toBeNull();
			assertPresent(signInRes.token, "Expected an auth token after re-sign-in");
			yield* listPluginsWithHeaders({ Authorization: `Bearer ${signInRes.token}` });
		}),
	);
});

describe("Reset link generation and completion for no-account user", () => {
	it.live("generates reset link, creates credential account, and signs in", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { email, userId } = yield* createNoAccountUser("NoneReset");

			const resetData = yield* client.call(
				(c) => c.godMode.resetUserPassword({ params: { userId } }),
				adminHeaders(),
			);
			expect(resetData.email).toBe(email);
			const token = new URL(resetData.resetUrl).searchParams.get("token");
			expect(typeof token).toBe("string");
			assertPresent(token, "missing token");

			const newPassword = "none-state-password-456!";
			const { error: resetError } = yield* Effect.promise(() =>
				createTestAuthClient().resetPassword({ token, newPassword }),
			);
			expect(resetError).toBeNull();

			const signInRes = yield* signInWithPassword(email, newPassword);
			expect(signInRes.error).toBeNull();

			const listData = yield* listUsers(email);
			expect(listData.items[0]?.authState).toBe("credential");
		}),
	);
});

describe("OIDC user restrictions", () => {
	it.live("rejects password reset for OIDC-only users", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { userId } = yield* createOidcUser("BlockedOidc");

			const error = yield* Effect.flip(
				client.call((c) => c.godMode.resetUserPassword({ params: { userId } }), adminHeaders()),
			);
			assertTaggedError(error, "GodModeRequestFailure");
			expect(error.reason).toEqual({ authState: "oidc", code: "password-reset-unsupported" });
		}),
	);
});

describe("Mixed auth user restrictions", () => {
	it.live("rejects password reset for mixed auth users", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { email } = yield* createTestUser();
			const userId = yield* getUserIdByEmail(email);

			yield* client.call(
				(c) =>
					c.testSupport.linkAuthAccount({
						payload: { userId, providerId: "oidc", accountId: `oidc-sub-${uniqueTimestamp()}` },
					}),
				adminHeaders(),
			);

			const error = yield* Effect.flip(
				client.call((c) => c.godMode.resetUserPassword({ params: { userId } }), adminHeaders()),
			);
			assertTaggedError(error, "GodModeRequestFailure");
			expect(error.reason).toEqual({ authState: "mixed", code: "password-reset-unsupported" });
		}),
	);
});
