import { describe, expect, it } from "vitest";

import { getSafeRedirectTo } from "./redirect";

describe("getSafeRedirectTo", () => {
	it.each(["/", "/(app)", "/library/123?tab=history#details"])(
		"accepts internal destination %s",
		(redirectTo) => {
			expect(getSafeRedirectTo(redirectTo)).toBe(redirectTo);
		},
	);

	it.each([
		undefined,
		"https://evil.example",
		"//evil.example",
		"/\\evil.example",
		"javascript:alert(1)",
		"../library",
		"/auth",
		"/auth/",
		"/auth//",
		"/%61uth",
		"/auth?redirectTo=/library",
		"/onboarding#connect",
		"/onboarding/",
	])("rejects unsafe destination %s", (redirectTo) => {
		expect(getSafeRedirectTo(redirectTo)).toBeUndefined();
	});

	it("rejects repeated parameters", () => {
		expect(getSafeRedirectTo(["/library", "https://evil.example"])).toBeUndefined();
	});
});
