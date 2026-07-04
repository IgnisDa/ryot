import { Effect } from "effect";

import {
	cookieHeaderFromSetCookies,
	createTestUser,
	enableTwoFactorForSession,
	getBackendClient,
} from "~/fixtures";
import { assertTaggedError, requireNonEmptyArray } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

const trackersListQuery = { includeDisabled: false };

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

			yield* client.call((c) => c.trackers.list({ urlParams: trackersListQuery }), {
				Cookie: twoFactorCookies,
			});

			const signInResponse = yield* Effect.promise(() =>
				fetch(`${baseUrl}/auth/sign-in/email`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ email, password }),
				}),
			);

			expect(signInResponse.ok).toBe(true);

			const signInSetCookies = signInResponse.headers.getSetCookie();
			requireNonEmptyArray(signInSetCookies, "Sign in succeeded but no cookies were returned");

			const signInCookies = cookieHeaderFromSetCookies(signInSetCookies);
			const signInData = yield* Effect.promise(() => signInResponse.json());
			expect(signInData).toHaveProperty("twoFactorRedirect", true);

			const unauthorizedError = yield* Effect.flip(
				client.call((c) => c.trackers.list({ urlParams: trackersListQuery }), {
					Cookie: signInCookies,
				}),
			);
			assertTaggedError(unauthorizedError, "Unauthorized");

			const verifyResponse = yield* Effect.promise(() =>
				fetch(`${baseUrl}/auth/two-factor/verify-backup-code`, {
					method: "POST",
					body: JSON.stringify({ code: backupCode }),
					headers: { Cookie: signInCookies, "Content-Type": "application/json" },
				}),
			);

			if (!verifyResponse.ok) {
				const error = yield* Effect.promise(() => verifyResponse.text());
				throw new Error(`Backup code verification failed: ${error}`);
			}

			const verifySetCookies = verifyResponse.headers.getSetCookie();
			const verifiedCookies = verifySetCookies.length
				? cookieHeaderFromSetCookies(verifySetCookies)
				: signInCookies;
			yield* client.call((c) => c.trackers.list({ urlParams: trackersListQuery }), {
				Cookie: verifiedCookies,
			});

			const secondSignInResponse = yield* Effect.promise(() =>
				fetch(`${baseUrl}/auth/sign-in/email`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ email, password }),
				}),
			);

			expect(secondSignInResponse.ok).toBe(true);

			const secondSignInSetCookies = secondSignInResponse.headers.getSetCookie();
			requireNonEmptyArray(
				secondSignInSetCookies,
				"Second sign in succeeded but no cookies were returned",
			);

			const secondSignInCookies = cookieHeaderFromSetCookies(secondSignInSetCookies);
			const secondSignInData = yield* Effect.promise(() => secondSignInResponse.json());
			expect(secondSignInData).toHaveProperty("twoFactorRedirect", true);

			const reuseResponse = yield* Effect.promise(() =>
				fetch(`${baseUrl}/auth/two-factor/verify-backup-code`, {
					method: "POST",
					body: JSON.stringify({ code: backupCode }),
					headers: { Cookie: secondSignInCookies, "Content-Type": "application/json" },
				}),
			);

			expect(reuseResponse.ok).toBe(false);
			const reuseError = yield* Effect.promise(() => reuseResponse.text());
			expect(reuseError).toMatch(/invalid/i);
		}),
	);
});
