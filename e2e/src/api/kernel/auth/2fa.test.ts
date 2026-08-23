import { Effect } from "effect";

import {
	createTestUser,
	enableTwoFactorForSession,
	getApiClient,
	signInWithPassword,
	verifyBackupCodeForSession,
} from "~/fixtures/kernel";
import { getApiUrl } from "~/support/api";
import { assertTaggedError, requireNonEmptyArray, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const pluginListQuery = { includeDisabled: false };

describe("Two-factor sign-in flow", () => {
	it.live("allows a 2FA-enabled user to sign in with a backup code", () =>
		Effect.gen(function* () {
			const baseUrl = getApiUrl();
			const client = getApiClient();
			const { token, email, password } = yield* createTestUser();

			const { backupCodes, token: twoFactorToken } = yield* Effect.promise(() =>
				enableTwoFactorForSession({ baseUrl, token, password }),
			);

			const [backupCode] = requireNonEmptyArray(
				backupCodes,
				"Two-factor setup did not return any backup codes",
			);

			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				Authorization: `Bearer ${twoFactorToken}`,
			});

			const signIn = yield* signInWithPassword(email, password, baseUrl);
			expect(signIn.error).toBeNull();
			const signInToken = requirePresent(
				signIn.token,
				"Sign in succeeded but no auth token was returned",
			);
			expect(signIn.data).toHaveProperty("twoFactorRedirect", true);

			const unauthorizedError = yield* Effect.flip(
				client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
					Authorization: `Bearer ${signInToken}`,
				}),
			);
			assertTaggedError(unauthorizedError, "AuthUnauthorized");

			const verification = yield* Effect.promise(() =>
				verifyBackupCodeForSession({
					baseUrl,
					code: backupCode,
					token: signInToken,
					twoFactorToken: signIn.twoFactorToken,
				}),
			);
			expect(verification.error).toBeNull();
			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				Authorization: `Bearer ${verification.token}`,
			});

			const secondSignIn = yield* signInWithPassword(email, password, baseUrl);
			expect(secondSignIn.error).toBeNull();
			const secondSignInToken = requirePresent(
				secondSignIn.token,
				"Second sign in succeeded but no auth token was returned",
			);
			expect(secondSignIn.data).toHaveProperty("twoFactorRedirect", true);

			const reuse = yield* Effect.promise(() =>
				verifyBackupCodeForSession({
					baseUrl,
					code: backupCode,
					token: secondSignInToken,
					twoFactorToken: secondSignIn.twoFactorToken,
				}),
			);
			expect(reuse.error?.message).toMatch(/invalid/i);
		}),
	);
});
