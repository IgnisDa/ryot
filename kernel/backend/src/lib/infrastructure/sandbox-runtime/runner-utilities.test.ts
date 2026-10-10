import { describe, expect, it } from "vitest";

import { executionError } from "./isolate-utilities";

const moduleDirectory = "ryot-module:/inline-module";
const payload = { scriptId: "script-1", executionId: "execution-1" };

const errorWithStack = (stack: readonly string[]) => {
	const error = new Error("intentional");
	Object.defineProperty(error, "stack", { value: ["Error: intentional", ...stack].join("\n") });
	return error;
};

describe("sandbox execution errors", () => {
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

	it("drops runtime, bundle, and dependency frames", () => {
		const error = errorWithStack([
			`    at run (${moduleDirectory}/script.ts:4:9)`,
			"    at ryot:external/sandbox-sdk/src/driver.ts:3:20",
			`    at ${moduleDirectory}/${"a".repeat(64)}.js:1:214`,
			"    at file:///sandbox/runner.mjs:918:12",
		]);

		const result = executionError(error, "execute", payload, moduleDirectory, "script-failure");

		expect(result.stack).toBe("    at script.ts:4:9");
	});

	it("reports no frames when the module identity is unknown", () => {
		const error = errorWithStack(["    at run (file:///sandbox/modules/script.ts:4:9)"]);

		expect(executionError(error, "execute", undefined, moduleDirectory, "script-failure")).toEqual({
			phase: "execute",
			message: "intentional",
			kind: "script-failure",
		});
	});
});
