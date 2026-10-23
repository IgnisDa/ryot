import { describe, expect, it } from "vitest";

import { SANDBOX_LIMITS, SANDBOX_LOG_TRUNCATION_MARKER } from "../protocol/limits";
import { createLogCollector, executionError } from "./utilities";

const specifier = `ryot-module:/${"a".repeat(64)}.js`;

const moduleDirectory = "ryot-module:/inline-module";
const payload = { scriptId: "script-1", executionId: "execution-1" };

const errorWithStack = (stack: readonly string[]) => {
	const error = new Error("intentional");
	Object.defineProperty(error, "stack", { value: ["Error: intentional", ...stack].join("\n") });
	return error;
};

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
				"    at sdk (ryot-module:/external/plugin-backend-sdk/driver.ts:3:20)",
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

	it("preserves every mapped source frame", () => {
		const frameCount = 12;
		const error = errorWithStack(
			Array.from(
				{ length: frameCount },
				(_, index) =>
					`    at sandboxFrame${index} (${moduleDirectory}/backend/scripts/entry.sandbox.ts:${index + 1}:${index + 2})`,
			),
		);

		const result = executionError(error, "execute", payload, moduleDirectory, "script-failure");

		expect(result.stack?.split("\n")).toHaveLength(frameCount);
		expect(result.line).toBe(1);
		expect(result.column).toBe(2);
		expect(result.stack).toContain("at backend/scripts/entry.sandbox.ts:1:2");
		expect(result.stack).toContain(
			`at backend/scripts/entry.sandbox.ts:${frameCount}:${frameCount + 1}`,
		);
	});

	it("reports no frames when the module identity is unknown", () => {
		const error = errorWithStack(["    at run (file:///sandbox/modules/script.ts:4:9)"]);

		expect(executionError(error, "execute", undefined, moduleDirectory, "script-failure")).toEqual({
			phase: "execute",
			message: "intentional",
			kind: "script-failure",
		});
	});

	it("bounds console entries and appends one truncation marker", () => {
		const collector = createLogCollector({ ...SANDBOX_LIMITS.logs, entryCount: 2 });

		collector.console.log("first");
		collector.console.error("second");
		collector.console.warn("third");

		expect(collector.logs).toEqual(["first", SANDBOX_LOG_TRUNCATION_MARKER]);
	});

	it("truncates UTF-8 only at a complete character boundary", () => {
		const collector = createLogCollector({ entryBytes: 3, entryCount: 3, totalBytes: 64 });

		collector.console.log("éé");

		expect(collector.logs).toEqual(["é", SANDBOX_LOG_TRUNCATION_MARKER]);
	});
});
