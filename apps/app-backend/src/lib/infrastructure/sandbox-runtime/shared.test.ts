import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { isJsonValue, requireUserSandboxRunInput } from "./shared";

const makeRunInput = (userId: string | null) => ({
	userId,
	context: {},
	metadata: {},
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script_1",
	driverName: "search",
	executionId: "exec_1",
	scriptIsBuiltin: false,
	allowedHostFunctions: [],
});

describe("requireUserSandboxRunInput", () => {
	it("returns the input when a user context is present", () => {
		const input = makeRunInput("user_1");
		expect(Effect.runSync(requireUserSandboxRunInput(input, "getUserPreferences"))).toBe(input);
	});

	it("rejects user-scoped host functions for system executions", () => {
		expect(() =>
			Effect.runSync(requireUserSandboxRunInput(makeRunInput(null), "getUserPreferences")),
		).toThrow("getUserPreferences is not available for system executions");
	});
});

describe("isJsonValue", () => {
	it("accepts nested JSON and rejects non-JSON objects", () => {
		expect(isJsonValue({ nested: [true, 42, null] })).toBe(true);
		expect(isJsonValue(new Date(0))).toBe(false);
	});
});
