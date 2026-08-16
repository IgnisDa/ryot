import { assert, describe, expect, it } from "vitest";

import { parseServerOrigin } from "../../api/origin";
import { sanitizeRedirect } from "./redirect";
import { decideOnboardingGate, decideRootGate } from "./route-gates";

describe("redirect sanitization", () => {
	it.each([
		"/",
		"/library",
		"/authentication",
		"/onboarding-notes",
		"/library/123?tab=history#details",
	])("preserves local destination %s", (value) => expect(sanitizeRedirect(value)).toBe(value));

	it.each([
		undefined,
		"library",
		"../library",
		"https://evil.example",
		"//evil.example",
		"/\\evil.example",
		"/%2F%2Fevil.example",
		"javascript:alert(1)",
		"/auth",
		"/AUTH",
		"/Auth/reset",
		"/%61uth/reset",
		"/onboarding",
		"/ONBOARDING",
		"/onboarding/connect",
		"/%E0%A4%A",
	])("rejects unsafe destination %s", (value) => {
		expect(sanitizeRedirect(value)).toBeUndefined();
	});
});

describe("route gates", () => {
	const result = parseServerOrigin("https://example.com");
	assert(result.ok);

	it("routes root according to server selection", () => {
		expect(decideRootGate(null)).toEqual({ action: "redirect", to: "/onboarding" });
		expect(decideRootGate(result.origin)).toEqual({ action: "redirect", to: "/auth" });
	});

	it("keeps safe intent while onboarding and uses it after connection", () => {
		expect(decideOnboardingGate(null, "/library?tab=history")).toEqual({
			action: "stay",
			redirectTo: "/library?tab=history",
		});
		expect(decideOnboardingGate(result.origin, "/library?tab=history")).toEqual({
			to: "/auth",
			action: "redirect",
			redirectTo: "/library?tab=history",
		});
	});

	it("falls back safely for unsafe intent", () => {
		expect(decideOnboardingGate(null, "https://evil.example")).toEqual({
			action: "stay",
			redirectTo: undefined,
		});
		expect(decideOnboardingGate(result.origin, "/auth/reset")).toEqual({
			to: "/auth",
			action: "redirect",
			redirectTo: undefined,
		});
	});
});
