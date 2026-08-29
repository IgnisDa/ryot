import { Effect } from "effect";

import {
	completeTwoFactorSignIn,
	createTestUser,
	enableTwoFactorForSession,
	getApiClient,
	signInWithPassword,
	verifyBackupCodeForSession,
} from "~/fixtures/kernel";
import { requireNonEmptyArray, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";

describe("Two-factor sign-in flow", () => {
	it.live("allows a 2FA-enabled user to sign in with a backup code", () =>
		Effect.gen(function* () {
			const baseUrl = getApiUrl();
			const client = getApiClient();
			const { token, email, password, sessionCookie } = yield* createTestUser();

			const { backupCodes, token: twoFactorToken } = yield* Effect.promise(() =>
				enableTwoFactorForSession({ token, baseUrl, password, sessionCookie }),
			);

			const [backupCode] = requireNonEmptyArray(
				backupCodes,
				"Two-factor setup did not return any backup codes",
			);

			yield* client.call((c) => c.plugins.list(), { Authorization: `Bearer ${twoFactorToken}` });

			const signIn = yield* signInWithPassword(email, password, baseUrl);
			expect(signIn.error).toBeNull();
			expect(signIn.token).toBeUndefined();
			expect(signIn.data).toHaveProperty("twoFactorRedirect", true);

			const verification = yield* Effect.promise(() =>
				verifyBackupCodeForSession({
					token,
					baseUrl,
					code: backupCode,
					twoFactorToken: signIn.twoFactorToken,
				}),
			);
			expect(verification.error).toBeNull();
			yield* client.call((c) => c.plugins.list(), {
				Authorization: `Bearer ${verification.token}`,
			});

			const secondSignIn = yield* signInWithPassword(email, password, baseUrl);
			expect(secondSignIn.error).toBeNull();
			expect(secondSignIn.token).toBeUndefined();
			expect(secondSignIn.data).toHaveProperty("twoFactorRedirect", true);

			const reuse = yield* Effect.promise(() =>
				verifyBackupCodeForSession({
					token,
					baseUrl,
					code: backupCode,
					twoFactorToken: secondSignIn.twoFactorToken,
				}),
			);
			expect(reuse.error).toEqual(
				expect.objectContaining({ message: expect.stringMatching(/invalid/i) }),
			);
		}),
	);

	it.live("completes hosted OAuth sign-in with a TOTP code", () =>
		Effect.gen(function* () {
			const baseUrl = getApiUrl();
			const client = getApiClient();
			const { token, email, password, sessionCookie } = yield* createTestUser();
			const { totpCodes } = yield* Effect.promise(() =>
				enableTwoFactorForSession({ token, baseUrl, password, sessionCookie }),
			);

			const signIn = yield* signInWithPassword(email, password, baseUrl);
			expect(signIn.error).toBeNull();
			expect(signIn.token).toBeUndefined();
			expect(signIn.data).toHaveProperty("twoFactorRedirect", true);

			const verification = yield* Effect.promise(() =>
				completeTwoFactorSignIn(
					baseUrl,
					requirePresent(signIn.twoFactorToken, "Missing two-factor browser cookie"),
					"/two-factor/verify-totp",
					{ code: totpCodes.current },
				),
			);
			const accessToken = requirePresent(
				verification.token,
				"TOTP continuation did not return an OAuth access token",
			);
			yield* client.call((c) => c.plugins.list(), { Authorization: `Bearer ${accessToken}` });
		}),
	);
});
