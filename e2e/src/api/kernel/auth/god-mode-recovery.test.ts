import { UserId } from "@ryot/contract/schema/brands";
import { DateTime, Effect } from "effect";

import {
	ADMIN_TOKEN,
	adminAccessTokenHeaders,
	createApiKey,
	createTestAuthClient,
	createTestUser,
	getApiClient,
	signInWithPassword,
} from "~/fixtures/kernel";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const WRONG_TOKEN = "wrong-token";
const godModeListQuery = (search?: string) => ({
	limit: 50,
	offset: 0,
	...(search ? { search } : {}),
});
const pluginListQuery = { includeDisabled: false };
const uniqueTimestamp = () => DateTime.toEpochMillis(DateTime.nowUnsafe());

const getUserIdByEmail = (email: string) =>
	Effect.gen(function* () {
		const data = yield* getApiClient().call(
			(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		const user = data.users[0];
		assertPresent(user, "missing user row");
		return UserId.make(user.id);
	});

const createNoAccountUser = (name: string) =>
	Effect.gen(function* () {
		const email = `${name.toLowerCase()}-${uniqueTimestamp()}@example.com`;
		const { userId } = yield* getApiClient().call(
			(c) => c.godMode.provisionUser({ payload: { provider: "credential", email, name } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		return { email, userId: UserId.make(userId) };
	});

const createOidcUser = (name: string) =>
	Effect.gen(function* () {
		const email = `${name.toLowerCase()}-${uniqueTimestamp()}@example.com`;
		const { userId } = yield* getApiClient().call(
			(c) =>
				c.godMode.provisionUser({
					payload: {
						name,
						email,
						provider: "oidc",
						oidcIssuerId: `oidc-sub-${uniqueTimestamp()}`,
					},
				}),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		return { email, userId: UserId.make(userId) };
	});

describe("God-mode admin token enforcement", () => {
	it.live("rejects user listing without auth header", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call((c) => c.godMode.listUsers({ query: godModeListQuery() })),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects user listing with wrong admin token", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call(
					(c) => c.godMode.listUsers({ query: godModeListQuery() }),
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
			const client = getApiClient();
			const { email } = yield* createNoAccountUser("NoneUser");

			const data = yield* client.call(
				(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			const user = data.users[0];
			expect(user?.authState).toBe("none");
			expect(user?.email).toBe(email);
		}),
	);

	it.live("classifies OIDC-only users as 'oidc'", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { email } = yield* createOidcUser("ListOidcUser");

			const data = yield* client.call(
				(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(data.users[0]?.authState).toBe("oidc");
		}),
	);

	it.live("classifies credential users as 'credential'", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { email } = yield* createTestUser();

			const data = yield* client.call(
				(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(data.users[0]?.authState).toBe("credential");
			expect(data.users[0]?.disabledAt).toBeNull();
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
						payload: {
							userId,
							providerId: "oidc",
							accountId: `oidc-sub-${uniqueTimestamp()}`,
						},
					}),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);

			const data = yield* client.call(
				(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(data.users[0]?.authState).toBe("mixed");
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
						payload: { provider: "credential", email, name: "Provisioned Credential" },
					}),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);

			const listData = yield* client.call(
				(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(listData.users[0]?.authState).toBe("none");
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
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);

			const listData = yield* client.call(
				(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(listData.users[0]?.authState).toBe("oidc");
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
							payload: { provider: "credential", email, name: "Duplicate" },
						}),
					adminAccessTokenHeaders(ADMIN_TOKEN),
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

			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				Authorization: `Bearer ${token}`,
			});

			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				"X-Api-Key": apiKey,
			});

			const disabledData = yield* client.call(
				(c) => c.godMode.setUserDisabled({ payload: { disabled: true }, params: { userId } }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(typeof disabledData.disabledAt).toBe("string");

			const listData = yield* client.call(
				(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(listData.users[0]?.disabledAt).toBe(disabledData.disabledAt);

			const revokedSession = yield* Effect.flip(
				client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
					Authorization: `Bearer ${token}`,
				}),
			);
			assertTaggedError(revokedSession, "AuthUnauthorized");

			const blockedApiKey = yield* Effect.flip(
				client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
					"X-Api-Key": apiKey,
				}),
			);
			assertTaggedError(blockedApiKey, "AuthUnauthorized");

			const blockedSignIn = yield* signInWithPassword(email, password);
			expect(blockedSignIn.error?.status).toBe(403);

			const enableData = yield* client.call(
				(c) => c.godMode.setUserDisabled({ payload: { disabled: false }, params: { userId } }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(enableData.disabledAt).toBeNull();

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
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(resetData.email).toBe(email);
			expect(typeof resetData.resetUrl).toBe("string");
			expect(resetData.resetUrl).toMatch(/\/reset-password\?token=.+/);

			const token = new URL(resetData.resetUrl).searchParams.get("token");
			expect(typeof token).toBe("string");
			assertPresent(token, "missing token");

			const newPassword = "new-password-456!";
			const { error: resetError } = yield* Effect.promise(() =>
				createTestAuthClient().resetPassword({
					token,
					newPassword,
				}),
			);
			expect(resetError).toBeNull();

			const signInRes = yield* signInWithPassword(email, newPassword);
			expect(signInRes.error).toBeNull();
			assertPresent(signInRes.token, "Expected an auth token after sign-in");
			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				Authorization: `Bearer ${signInRes.token}`,
			});
		}),
	);

	it.live("revokes sessions after password reset", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { token: authToken, email } = yield* createTestUser();

			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				Authorization: `Bearer ${authToken}`,
			});

			const userId = yield* getUserIdByEmail(email);

			const resetData = yield* client.call(
				(c) => c.godMode.resetUserPassword({ params: { userId } }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			const token = new URL(resetData.resetUrl).searchParams.get("token");
			expect(typeof token).toBe("string");
			assertPresent(token, "missing token");

			const newPassword = "revoked-session-pw!";
			const { error: resetError } = yield* Effect.promise(() =>
				createTestAuthClient().resetPassword({ token, newPassword }),
			);
			expect(resetError).toBeNull();

			const oldSessionError = yield* Effect.flip(
				client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
					Authorization: `Bearer ${authToken}`,
				}),
			);
			assertTaggedError(oldSessionError, "AuthUnauthorized");

			const signInRes = yield* signInWithPassword(email, newPassword);
			expect(signInRes.error).toBeNull();
			assertPresent(signInRes.token, "Expected an auth token after re-sign-in");
			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				Authorization: `Bearer ${signInRes.token}`,
			});
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
				adminAccessTokenHeaders(ADMIN_TOKEN),
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

			const listData = yield* client.call(
				(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(listData.users[0]?.authState).toBe("credential");
		}),
	);
});

describe("OIDC user restrictions", () => {
	it.live("rejects password reset for OIDC-only users", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { userId } = yield* createOidcUser("BlockedOidc");

			const error = yield* Effect.flip(
				client.call(
					(c) => c.godMode.resetUserPassword({ params: { userId } }),
					adminAccessTokenHeaders(ADMIN_TOKEN),
				),
			);
			assertTaggedError(error, "GodModeRequestFailure");
			expect(error.reason).toEqual({ code: "password-reset-unsupported", authState: "oidc" });
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
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);

			const error = yield* Effect.flip(
				client.call(
					(c) => c.godMode.resetUserPassword({ params: { userId } }),
					adminAccessTokenHeaders(ADMIN_TOKEN),
				),
			);
			assertTaggedError(error, "GodModeRequestFailure");
			expect(error.reason).toEqual({ code: "password-reset-unsupported", authState: "mixed" });
		}),
	);
});
