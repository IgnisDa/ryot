import { randomUUID } from "node:crypto";

import { UserId } from "@ryot-app/contract/schema/brands";
import { godModeUsersRecipe } from "@ryot-app/ryotql-recipes/god-mode";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { Effect } from "effect";

import {
	adminAccessTokenHeaders,
	adminHeaders,
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	createApiKey,
	createTestAuthClient,
	createTestUser,
	executeAdminRyotQLRecipe,
	findBuiltinPluginBySlug,
	getApiClient,
	makeSession,
	pollUserLifecycleOperation,
	requestUserReset,
	resetUserAndWait,
	signInWithPassword,
	updatePluginState,
} from "~/fixtures/kernel";
import { assertPresent, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const WRONG_TOKEN = "wrong-token";

const listPluginsWithHeaders = (headers: Record<string, string>) =>
	collectRyotQLRecipeItems(makeSession(undefined, headers), (after) =>
		pluginInstallationsRecipe({ after, limit: 100 }),
	);
const listUsers = (search: string) =>
	executeAdminRyotQLRecipe(godModeUsersRecipe({ search, limit: 50 }));
const unique = () => randomUUID();

const getUserIdByEmail = (email: string) =>
	Effect.gen(function* () {
		const data = yield* listUsers(email);
		const user = data.items[0];
		assertPresent(user, "missing user row");
		return user.id;
	});

const createNoAccountUser = (name: string) =>
	Effect.gen(function* () {
		const email = `${name.toLowerCase()}-${unique()}@example.com`;
		const { userId } = yield* getApiClient().call(
			(c) => c.godMode.provisionUser({ payload: { name, email, provider: "credential" } }),
			adminHeaders(),
		);
		return { email, userId: UserId.make(userId) };
	});

const createOidcUser = (name: string) =>
	Effect.gen(function* () {
		const email = `${name.toLowerCase()}-${unique()}@example.com`;
		const { userId } = yield* getApiClient().call(
			(c) =>
				c.godMode.provisionUser({
					payload: { name, email, provider: "oidc", oidcIssuerId: `oidc-sub-${unique()}` },
				}),
			adminHeaders(),
		);
		return { email, userId: UserId.make(userId) };
	});

describe("Reset user admin token enforcement", () => {
	it.live("rejects resetUser without auth header", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call((c) => c.godMode.resetUser({ params: { userId: UserId.make("any-id") } })),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects resetUser with wrong admin token", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call(
					(c) => c.godMode.resetUser({ params: { userId: UserId.make("any-id") } }),
					adminAccessTokenHeaders(WRONG_TOKEN),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects resetUser for a non-existent user", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call(
					(c) => c.godMode.resetUser({ params: { userId: UserId.make(`missing-${unique()}`) } }),
					adminHeaders(),
				),
			);
			assertTaggedError(error, "GodModeNotFound");
			expect(error.reason.code).toBe("user-not-found");
		}),
	);
});

describe("Reset user for credential user", () => {
	it.live("wipes data, kills old session and api key, and rebuilds baseline", () =>
		Effect.gen(function* () {
			const {
				email,
				sessionCookie,
				token: authToken,
				userId: rawUserId,
				client: userClient,
			} = yield* createAuthenticatedClient();
			const userId = UserId.make(rawUserId);
			const apiKey = yield* createApiKey(sessionCookie);

			// Both auth methods work before the reset.
			yield* listPluginsWithHeaders({ Authorization: `Bearer ${authToken}` });
			yield* listPluginsWithHeaders({ "X-Api-Key": apiKey });

			const plugin = yield* findBuiltinPluginBySlug(userClient, "media");
			yield* updatePluginState(userClient, plugin.slug, { sortOrder: 41, isDisabled: true });
			const configuredPlugin = yield* findBuiltinPluginBySlug(userClient, "media");
			expect(configuredPlugin).toMatchObject({ sortOrder: 41, isDisabled: true });

			const accepted = yield* requestUserReset(userId);
			expect(accepted).toEqual({ operationId: expect.any(String) });

			const oldSession = yield* Effect.flip(
				listPluginsWithHeaders({ Authorization: `Bearer ${authToken}` }),
			);
			assertTaggedError(oldSession, "AuthUnauthorized");

			const oldApiKey = yield* Effect.flip(listPluginsWithHeaders({ "X-Api-Key": apiKey }));
			assertTaggedError(oldApiKey, "AuthUnauthorized");

			const reset = yield* pollUserLifecycleOperation(accepted.operationId);
			expect(reset.status).toBe("completed");
			const resetData = requirePresent(reset.resetResult, "expected a completed reset result");
			expect(resetData.userId).toBe(userId);
			expect(resetData.email).toBe(email);
			assertPresent(resetData.resetUrl, "expected a reset url for a credential user");
			expect(resetData.resetUrl).toMatch(/\/reset-password\?token=.+/);

			const token = new URL(resetData.resetUrl).searchParams.get("token");
			assertPresent(token, "missing token");
			const newPassword = "reset-user-pw-123!";
			const { error: resetError } = yield* Effect.promise(() =>
				createTestAuthClient().resetPassword({ token, newPassword }),
			);
			expect(resetError).toBeNull();

			const signInRes = yield* signInWithPassword(email, newPassword);
			expect(signInRes.error).toBeNull();
			assertPresent(signInRes.token, "expected an auth token after sign-in");

			const plugins = yield* listPluginsWithHeaders({ Authorization: `Bearer ${signInRes.token}` });
			expect(plugins.some((candidate) => candidate.slug === "media")).toBe(true);
			const resetPlugin = plugins.find((candidate) => candidate.slug === plugin.slug);
			assertPresent(resetPlugin, "expected the installed plugin after reset");
			expect(resetPlugin).toMatchObject({ sortOrder: 0, isDisabled: false });
		}),
	);
});

describe("Reset user for no-account user", () => {
	it.live("returns a working reset link and lands the user in a credential state", () =>
		Effect.gen(function* () {
			const { email, userId } = yield* createNoAccountUser("ResetNone");

			const reset = yield* resetUserAndWait(userId);
			const resetData = requirePresent(reset.resetResult, "expected a completed reset result");
			expect(resetData.email).toBe(email);
			assertPresent(resetData.resetUrl, "expected a reset url for a no-account user");

			const token = new URL(resetData.resetUrl).searchParams.get("token");
			assertPresent(token, "missing token");
			const newPassword = "reset-none-pw-123!";
			const { error: resetError } = yield* Effect.promise(() =>
				createTestAuthClient().resetPassword({ token, newPassword }),
			);
			expect(resetError).toBeNull();

			const signInRes = yield* signInWithPassword(email, newPassword);
			expect(signInRes.error).toBeNull();

			const listData = yield* listUsers(email);
			expect(listData.items[0]?.authState).toBe("credential");
			expect(listData.items[0]?.id).toBe(userId);
		}),
	);
});

describe("Reset user for OIDC user", () => {
	it.live("returns a null reset url and preserves the oidc auth state", () =>
		Effect.gen(function* () {
			const { email, userId } = yield* createOidcUser("ResetOidc");

			const reset = yield* resetUserAndWait(userId);
			const resetData = requirePresent(reset.resetResult, "expected a completed reset result");
			expect(resetData.email).toBe(email);
			expect(resetData.resetUrl).toBeNull();

			const listData = yield* listUsers(email);
			expect(listData.items[0]?.authState).toBe("oidc");
			expect(listData.items[0]?.id).toBe(userId);
		}),
	);
});

describe("Reset user for mixed-auth user", () => {
	it.live("rejects the reset and leaves the existing session intact", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const { token, email } = yield* createTestUser();
			const userId = yield* getUserIdByEmail(email);

			yield* client.call(
				(c) =>
					c.testSupport.linkAuthAccount({
						payload: { userId, providerId: "oidc", accountId: `oidc-sub-${unique()}` },
					}),
				adminHeaders(),
			);

			const error = yield* Effect.flip(
				client.call((c) => c.godMode.resetUser({ params: { userId } }), adminHeaders()),
			);
			assertTaggedError(error, "GodModeRequestFailure");
			expect(error.reason.code).toBe("mixed-auth-reset-unsupported");

			// The reset is rejected before any mutation, so the pre-existing session keeps working.
			yield* listPluginsWithHeaders({ Authorization: `Bearer ${token}` });
		}),
	);
});
