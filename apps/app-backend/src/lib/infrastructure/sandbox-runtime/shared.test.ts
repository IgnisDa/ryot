import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { isJsonValue, requireSystemSandboxRunInput, requireUserSandboxRunInput } from "./shared";

const makeRunInput = (userId: string | null, driverName = "search") => ({
	userId,
	driverName,
	context: {},
	metadata: {},
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script_1",
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

describe("requireSystemSandboxRunInput", () => {
	it("accepts only system cron or boot executions without a subscription marker", () => {
		const cronInput = makeRunInput(null, "cron");
		expect(Effect.runSync(requireSystemSandboxRunInput(cronInput, "upsertGlobalEntities"))).toBe(
			cronInput,
		);
		const bootInput = makeRunInput(null, "boot");
		expect(Effect.runSync(requireSystemSandboxRunInput(bootInput, "upsertGlobalEntities"))).toBe(
			bootInput,
		);
		expect(() =>
			Effect.runSync(requireSystemSandboxRunInput(makeRunInput("user_1"), "upsertGlobalEntities")),
		).toThrow("upsertGlobalEntities is available only to system executions");
		expect(() =>
			Effect.runSync(requireSystemSandboxRunInput(makeRunInput(null), "upsertGlobalEntities")),
		).toThrow("upsertGlobalEntities is available only to system executions");
	});
});

describe("isJsonValue", () => {
	it("accepts nested JSON and rejects non-JSON objects", () => {
		expect(isJsonValue({ nested: [true, 42, null] })).toBe(true);
		expect(isJsonValue(new Date(0))).toBe(false);
	});
});
