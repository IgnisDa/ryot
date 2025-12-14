import { describe, expect, it } from "vitest";

import { resolveEffectiveHostFunctions } from "./durable-queues";

const allowlist = ["createEvents", "emitSignal", "httpCall", "sendNotification"];

describe("sandbox execution-kind capability ceilings", () => {
	it.each(["policy", "provider"] as const)(
		"removes automation-producing functions from %s runs",
		(executionKind) => {
			expect(resolveEffectiveHostFunctions({ executionKind, scriptAllowlist: allowlist })).toEqual([
				"httpCall",
			]);
		},
	);

	it("keeps createEvents only for direct runs", () => {
		expect(
			resolveEffectiveHostFunctions({ executionKind: "direct", scriptAllowlist: allowlist }),
		).toEqual(["createEvents", "httpCall"]);
	});

	it("intersects subscription capabilities with the rule ceiling", () => {
		expect(
			resolveEffectiveHostFunctions({
				scriptAllowlist: allowlist,
				executionKind: "subscription",
				capabilityCeiling: ["emitSignal", "httpCall"],
			}),
		).toEqual(["emitSignal", "httpCall"]);
	});
});
