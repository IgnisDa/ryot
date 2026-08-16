import { describe, expect, it } from "vitest";

import {
	authDestination,
	availableTwoFactorMethods,
	isTwoFactorRedirect,
	signOutToAuth,
} from "./flow";

describe("authentication flow", () => {
	it("uses only safe local callback destinations", () => {
		expect(authDestination("/library?tab=recent")).toBe("/library?tab=recent");
		expect(authDestination("https://evil.test/path")).toBe("/");
		expect(authDestination("//evil.test/path")).toBe("/");
		expect(authDestination("/auth?redirect=/library")).toBe("/");
	});

	it("detects two-factor redirects and chooses configured methods", () => {
		expect(isTwoFactorRedirect({ twoFactorRedirect: true, twoFactorMethods: ["totp"] })).toBe(true);
		expect(isTwoFactorRedirect({ twoFactorRedirect: false })).toBe(false);
		expect(availableTwoFactorMethods(["totp"])).toEqual(["totp", "backupCode"]);
		expect(availableTwoFactorMethods([])).toEqual(["backupCode"]);
	});

	it.each([false, true])("returns to auth when sign-out failure is %s", async (fails) => {
		const calls: string[] = [];

		await expect(
			signOutToAuth({
				signOut: () => {
					calls.push("sign-out");
					return fails ? Promise.reject(new Error("offline")) : Promise.resolve();
				},
				clearAuth: () => calls.push("clear-auth"),
				navigate: () => {
					calls.push("navigate");
					return Promise.resolve();
				},
			}),
		).resolves.toBeUndefined();
		expect(calls).toEqual(["sign-out", "clear-auth", "navigate"]);
	});
});
