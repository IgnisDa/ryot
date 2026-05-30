import { describe, expect, it } from "vitest";

import { requireSandboxRunInput, requireUserSandboxRunInput } from "./shared";

const makeRunInput = (userId: string | null) => ({
	userId,
	code: "",
	context: {},
	scriptId: "script_1",
	driverName: "search",
	executionId: "exec_1",
	allowedHostFunctions: [],
});

describe("requireUserSandboxRunInput", () => {
	it("returns the input when a user context is present", () => {
		const input = makeRunInput("user_1");
		expect(requireUserSandboxRunInput([input], 0, "getUserPreferences")).toBe(input);
	});

	it("rejects user-scoped host functions for system executions", () => {
		expect(() => requireUserSandboxRunInput([makeRunInput(null)], 0, "getUserPreferences")).toThrow(
			"getUserPreferences is not available for system executions",
		);
	});
});

describe("requireSandboxRunInput", () => {
	it("accepts system executions for user-agnostic host functions", () => {
		const input = makeRunInput(null);
		expect(requireSandboxRunInput([input], 0, "getCachedValue")).toBe(input);
	});
});
