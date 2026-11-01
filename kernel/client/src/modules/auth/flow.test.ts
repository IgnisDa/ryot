import { describe, expect, it } from "vitest";

import {
	authDestination,
	availableTwoFactorMethods,
	isTwoFactorRedirect,
} from "#/modules/auth/flow";

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
});
