import { describe, expect, it } from "vitest";

import { hasForbiddenGlobalRuleCapability, resolveRuleCapabilityCeiling } from "./capabilities";

const allowlist = ["emitSignal", "httpCall", "sendNotification"];

describe("automation rule capability ceilings", () => {
	it("prevents global rules from notifying directly", () => {
		expect(hasForbiddenGlobalRuleCapability(allowlist)).toBe(true);
		expect(
			resolveRuleCapabilityCeiling({ isGlobalRule: true, scriptAllowlist: allowlist }),
		).toEqual(["emitSignal", "httpCall"]);
	});

	it("lets user-owned rules keep emitSignal and sendNotification", () => {
		expect(
			resolveRuleCapabilityCeiling({ isGlobalRule: false, scriptAllowlist: allowlist }),
		).toEqual(["emitSignal", "httpCall", "sendNotification"]);
	});
});
