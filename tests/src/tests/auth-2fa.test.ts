import { describe, expect, it } from "bun:test";

import { createTestUser } from "../fixtures/auth";
import { cookieHeaderFromSetCookies, enableTwoFactorForSession } from "../fixtures/auth-2fa";
import { getBackendClient, getBackendUrl } from "../setup";
import { requireNonEmptyArray } from "../test-support/assertions";

describe("Two-factor sign-in flow", () => {
	it("allows a 2FA-enabled user to sign in with a backup code", async () => {
		const baseUrl = getBackendUrl();
		const client = getBackendClient();
		const { cookies, email, password } = await createTestUser();

		const { backupCodes, cookies: twoFactorCookies } = await enableTwoFactorForSession({
			baseUrl,
			cookies,
			password,
		});

		const [backupCode] = requireNonEmptyArray(
			backupCodes,
			"Two-factor setup did not return any backup codes",
		);

		const enabledSession = await client.GET("/trackers", {
			headers: { Cookie: twoFactorCookies },
		});
		expect(enabledSession.response.status).toBe(200);

		const signInResponse = await fetch(`${baseUrl}/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		});

		expect(signInResponse.ok).toBe(true);

		const signInSetCookies = signInResponse.headers.getSetCookie();
		requireNonEmptyArray(signInSetCookies, "Sign in succeeded but no cookies were returned");

		const signInCookies = cookieHeaderFromSetCookies(signInSetCookies);
		const signInData = await signInResponse.json();
		expect(signInData).toHaveProperty("twoFactorRedirect", true);

		const unauthorizedResponse = await client.GET("/trackers", {
			headers: { Cookie: signInCookies },
		});
		expect(unauthorizedResponse.response.status).toBe(401);

		const verifyResponse = await fetch(`${baseUrl}/auth/two-factor/verify-backup-code`, {
			method: "POST",
			body: JSON.stringify({ code: backupCode }),
			headers: { Cookie: signInCookies, "Content-Type": "application/json" },
		});

		if (!verifyResponse.ok) {
			const error = await verifyResponse.text();
			throw new Error(`Backup code verification failed: ${error}`);
		}

		const verifySetCookies = verifyResponse.headers.getSetCookie();
		const verifiedCookies = verifySetCookies.length
			? cookieHeaderFromSetCookies(verifySetCookies)
			: signInCookies;
		const protectedResponse = await client.GET("/trackers", {
			headers: { Cookie: verifiedCookies },
		});
		expect(protectedResponse.response.status).toBe(200);

		const secondSignInResponse = await fetch(`${baseUrl}/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		});

		expect(secondSignInResponse.ok).toBe(true);

		const secondSignInSetCookies = secondSignInResponse.headers.getSetCookie();
		requireNonEmptyArray(
			secondSignInSetCookies,
			"Second sign in succeeded but no cookies were returned",
		);

		const secondSignInCookies = cookieHeaderFromSetCookies(secondSignInSetCookies);
		const secondSignInData = await secondSignInResponse.json();
		expect(secondSignInData).toHaveProperty("twoFactorRedirect", true);

		const reuseResponse = await fetch(`${baseUrl}/auth/two-factor/verify-backup-code`, {
			method: "POST",
			body: JSON.stringify({ code: backupCode }),
			headers: { Cookie: secondSignInCookies, "Content-Type": "application/json" },
		});

		expect(reuseResponse.ok).toBe(false);
		const reuseError = await reuseResponse.text();
		expect(reuseError).toMatch(/invalid/i);
	});
});
