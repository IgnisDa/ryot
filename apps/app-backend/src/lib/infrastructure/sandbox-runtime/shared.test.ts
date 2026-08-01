import type { ExecutionAuthority } from "@ryot/contract/modules/sandbox/schemas";
import { SandboxProviderId, SubscriptionRunId, UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { isJsonValue, requireSandboxCapabilityInput } from "./shared";

const makeRunInput = (
	authority: ExecutionAuthority,
	providerId: SandboxProviderId | null = null,
	metadata: unknown = {},
) => ({
	authority,
	providerId,
	context: {},
	metadata,
	contentHash: "",
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script_1",
	executionId: "exec_1",
	allowedHostFunctions: [],
});

describe("requireSandboxCapabilityInput", () => {
	it("returns input when authority and metadata satisfy capability policy", () => {
		const input = makeRunInput({ type: "user", userId: UserId.make("user_1") });
		expect(Effect.runSync(requireSandboxCapabilityInput(input, "getUserPreferences"))).toBe(input);
	});

	it("rejects user-only capabilities for subscriptions", () => {
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(
					makeRunInput({
						type: "subscription",
						userId: UserId.make("user_1"),
						subscriptionRun: {
							id: SubscriptionRunId.make("run_1"),
							occurredAt: "2026-01-01T00:00:00.000Z",
							origin: { kind: "api" },
						},
					}),
					"ensureUserEntities",
				),
			),
		).toThrow("ensureUserEntities is available only to user executions");
	});

	it("accepts system script capabilities and requires provider scope when declared", () => {
		const input = makeRunInput({ type: "system" }, SandboxProviderId.make("provider_1"), {
			kind: "script",
		});
		expect(Effect.runSync(requireSandboxCapabilityInput(input, "upsertGlobalEntities"))).toBe(
			input,
		);
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(
					makeRunInput({ type: "system" }, null, { kind: "script" }),
					"upsertGlobalEntities",
				),
			),
		).toThrow("upsertGlobalEntities is available only to provider-associated scripts");
	});

	it("limits system query access to approved metadata kinds", () => {
		const script = makeRunInput({ type: "system" }, null, { kind: "script" });
		expect(Effect.runSync(requireSandboxCapabilityInput(script, "executeQueryEngine"))).toBe(
			script,
		);
	});

	it("restricts automation capabilities to trusted automation executions", () => {
		const automation = makeRunInput({ type: "system" }, null, { kind: "automation" });
		expect(Effect.runSync(requireSandboxCapabilityInput(automation, "emitSignal"))).toBe(
			automation,
		);
		expect(() =>
			Effect.runSync(requireSandboxCapabilityInput(makeRunInput({ type: "system" }), "emitSignal")),
		).toThrow("emitSignal is not available to this system execution");
	});
});

describe("isJsonValue", () => {
	it("accepts nested JSON and rejects non-JSON objects", () => {
		expect(isJsonValue({ nested: [true, 42, null] })).toBe(true);
		expect(isJsonValue(new Date(0))).toBe(false);
	});
});
