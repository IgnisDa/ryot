import type { ExecutionAuthority } from "@ryot/contract/modules/sandbox/schemas";
import { SandboxProviderId, UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
	isJsonValue,
	requireSystemProviderSandboxRunInput,
	requireSystemSandboxRunInput,
	requireUserSandboxRunInput,
} from "./shared";

const makeRunInput = (
	authority: ExecutionAuthority,
	providerId: SandboxProviderId | null = null,
) => ({
	authority,
	providerId,
	context: {},
	metadata: {},
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script_1",
	executionId: "exec_1",
	scriptIsBuiltin: false,
	allowedHostFunctions: [],
	cacheNamespace: "script_1",
});

describe("requireUserSandboxRunInput", () => {
	it("returns the input when a user context is present", () => {
		const input = makeRunInput({ type: "user", userId: UserId.make("user_1") });
		expect(Effect.runSync(requireUserSandboxRunInput(input, "getUserPreferences"))).toBe(input);
	});

	it("rejects user-scoped host functions for system executions", () => {
		expect(() =>
			Effect.runSync(
				requireUserSandboxRunInput(makeRunInput({ type: "system" }), "getUserPreferences"),
			),
		).toThrow("getUserPreferences is not available for system executions");
	});
});

describe("requireSystemSandboxRunInput", () => {
	it("accepts only explicit system authority", () => {
		const systemInput = makeRunInput({ type: "system" });
		expect(Effect.runSync(requireSystemSandboxRunInput(systemInput, "upsertGlobalEntities"))).toBe(
			systemInput,
		);
		expect(() =>
			Effect.runSync(
				requireSystemSandboxRunInput(
					makeRunInput({ type: "user", userId: UserId.make("user_1") }),
					"upsertGlobalEntities",
				),
			),
		).toThrow("upsertGlobalEntities is available only to system executions");
	});
});

describe("requireSystemProviderSandboxRunInput", () => {
	it("accepts only system authority executing a provider-associated script", () => {
		const providerInput = makeRunInput({ type: "system" }, SandboxProviderId.make("provider_1"));
		expect(
			Effect.runSync(requireSystemProviderSandboxRunInput(providerInput, "upsertGlobalEntities")),
		).toBe(providerInput);
		expect(() =>
			Effect.runSync(
				requireSystemProviderSandboxRunInput(
					makeRunInput({ type: "system" }),
					"upsertGlobalEntities",
				),
			),
		).toThrow("upsertGlobalEntities is available only to provider-associated scripts");
		expect(() =>
			Effect.runSync(
				requireSystemProviderSandboxRunInput(
					makeRunInput(
						{ type: "user", userId: UserId.make("user_1") },
						SandboxProviderId.make("provider_1"),
					),
					"upsertGlobalEntities",
				),
			),
		).toThrow("upsertGlobalEntities is available only to system executions");
	});
});

describe("isJsonValue", () => {
	it("accepts nested JSON and rejects non-JSON objects", () => {
		expect(isJsonValue({ nested: [true, 42, null] })).toBe(true);
		expect(isJsonValue(new Date(0))).toBe(false);
	});
});
