import { Effect } from "effect";

import {
	createTestUser,
	enableTwoFactorForSession,
	getBackendClient,
	signInWithPassword,
	verifyBackupCodeForSession,
} from "~/fixtures";
import { assertTaggedError, requireNonEmptyArray, requirePresent } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

const workspaceListQuery = { includeDisabled: false };

describe("Two-factor sign-in flow", () => {
	it.live("allows a 2FA-enabled user to sign in with a backup code", () =>
		Effect.gen(function* () {
			const baseUrl = getBackendUrl();
			const client = getBackendClient();
			const { cookies, email, password } = yield* createTestUser();

			const { backupCodes, cookies: twoFactorCookies } = yield* Effect.promise(() =>
				enableTwoFactorForSession({ baseUrl, cookies, password }),
			);

			const [backupCode] = requireNonEmptyArray(
				backupCodes,
				"Two-factor setup did not return any backup codes",
			);

			yield* client.call((c) => c.definitions.listWorkspaces({ urlParams: workspaceListQuery }), {
				Cookie: twoFactorCookies,
			});

			const signIn = yield* signInWithPassword(email, password, baseUrl);
			expect(signIn.error).toBeNull();
			const signInCookies = requirePresent(
				signIn.cookies,
				"Sign in succeeded but no cookies were returned",
			);
			expect(signIn.data).toHaveProperty("twoFactorRedirect", true);

			const unauthorizedError = yield* Effect.flip(
				client.call((c) => c.definitions.listWorkspaces({ urlParams: workspaceListQuery }), {
					Cookie: signInCookies,
				}),
			);
			assertTaggedError(unauthorizedError, "Unauthorized");

			const verification = yield* Effect.promise(() =>
				verifyBackupCodeForSession({ code: backupCode, cookies: signInCookies, baseUrl }),
			);
			expect(verification.error).toBeNull();
			yield* client.call((c) => c.definitions.listWorkspaces({ urlParams: workspaceListQuery }), {
				Cookie: verification.cookies,
			});

			const secondSignIn = yield* signInWithPassword(email, password, baseUrl);
			expect(secondSignIn.error).toBeNull();
			const secondSignInCookies = requirePresent(
				secondSignIn.cookies,
				"Second sign in succeeded but no cookies were returned",
			);
			expect(secondSignIn.data).toHaveProperty("twoFactorRedirect", true);

			const reuse = yield* Effect.promise(() =>
				verifyBackupCodeForSession({
					baseUrl,
					code: backupCode,
					cookies: secondSignInCookies,
				}),
			);
			expect(reuse.error?.message).toMatch(/invalid/i);
		}),
	);
});
