import { describe, expect, it } from "vitest";

import { createLogCollector, executionError } from "./isolate-utilities";
import { SANDBOX_RUNNER_LIMITS } from "./limits";

const specifier = `ryot-module:/${"a".repeat(64)}.js`;

const stackError = (stack: readonly string[]) => {
	const error = new Error(`failure in ${specifier} execution-secret script-secret`);
	Object.defineProperty(error, "stack", { value: ["Error: failure", ...stack].join("\n") });
	return error;
};

describe("isolate runner diagnostics", () => {
	it("keeps authored source-map frames and removes runtime paths and identifiers", () => {
		const result = executionError(
			stackError([
				"    at run (ryot-module:/scripts/entry.sandbox.ts:10:11)",
				`    at bundle (${specifier}:1:44)`,
				"    at sdk (ryot-module:/external/sandbox-sdk/driver.ts:3:20)",
				"    at runner (file:///sandbox/runner.mjs:918:12)",
			]),
			"execute",
			{ scriptId: "script-secret", executionId: "execution-secret" },
			specifier,
			"script-failure",
		);

		expect(result.stack).toBe("    at scripts/entry.sandbox.ts:10:11");
		expect(result.line).toBe(10);
		expect(result.column).toBe(11);
		expect(result.message).not.toContain(specifier);
		expect(result.message).not.toContain("execution-secret");
		expect(result.message).not.toContain("script-secret");
	});

	it("bounds console entries and appends one truncation marker", () => {
		const collector = createLogCollector({ ...SANDBOX_RUNNER_LIMITS, logEntryCount: 2 });

		collector.console.log("first");
		collector.console.error("second");
		collector.console.warn("third");

		expect(collector.logs).toEqual(["first", SANDBOX_RUNNER_LIMITS.logTruncationMarker]);
	});

	it("truncates UTF-8 only at a complete character boundary", () => {
		const collector = createLogCollector({
			...SANDBOX_RUNNER_LIMITS,
			logEntryBytes: 3,
			logEntryCount: 3,
			logTotalBytes: 64,
		});

		collector.console.log("éé");

		expect(collector.logs).toEqual(["é", SANDBOX_RUNNER_LIMITS.logTruncationMarker]);
	});
});
