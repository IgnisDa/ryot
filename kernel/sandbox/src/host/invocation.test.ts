import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import { UserId } from "@ryot-app/contract/schema/brands";
import { isJsonValue } from "@ryot-app/contract/schema/json";
import { Effect, PlatformError } from "effect";
import { describe, expect, it } from "vitest";

import { selectSandboxHostFunctions } from "./executor";
import { sandboxPlatformFailureKind } from "./invocation";
import { automationRunSubject, makeSubjectRunInput } from "./run-input.test-support";

describe("selectSandboxHostFunctions", () => {
	const selection: ReadonlyArray<
		readonly [
			name: string,
			kind: "script" | "workflow",
			capabilities: undefined | ReadonlyArray<string>,
			bound: ReadonlyArray<string>,
			expected: ReadonlyArray<string>,
		]
	> = [
		["binds nothing without declared capabilities", "script", undefined, ["log", "span"], []],
		["ignores unknown capability names", "script", ["log", "unknown"], ["log", "span"], ["log"]],
		[
			"never binds filesystem grant capabilities",
			"script",
			["scratch", "artifact-read", "httpCall"],
			["scratch", "httpCall"],
			["httpCall"],
		],
		[
			"keeps replayJournal out of workflow selection",
			"workflow",
			["httpCall"],
			["httpCall", "replayJournal"],
			[],
		],
		[
			"does not bind replayJournal alone",
			"script",
			["replayJournal"],
			["httpCall", "replayJournal"],
			[],
		],
		[
			"binds only the ordinary capability beside replayJournal",
			"script",
			["httpCall", "replayJournal"],
			["httpCall", "replayJournal"],
			["httpCall"],
		],
		[
			"gates executeRyotql by the declared capability",
			"script",
			["executeRyotql"],
			["executeRyotql"],
			["executeRyotql"],
		],
	];

	it.each(selection)("selects host functions: %s", (_name, kind, capabilities, bound, expected) => {
		const input = makeSubjectRunInput(
			{ type: "system" },
			{ kind, capabilities: capabilities === undefined ? undefined : [...capabilities] },
		);
		const functions = Object.fromEntries(bound.map((name) => [name, () => Effect.void]));

		expect(Object.keys(selectSandboxHostFunctions(functions, input))).toEqual(expected);
	});

	it("exposes only resource-free capabilities to non-workflow executions", () => {
		const input = makeSubjectRunInput(automationRunSubject("after", UserId.make("user_1")));
		const functions = Object.fromEntries(
			SANDBOX_HOST_CAPABILITIES.map((capability) => [capability, () => Effect.void]),
		);
		for (const capability of [
			"createEvents",
			"updateEvents",
			"deleteEvents",
			"listIntegrations",
			"sendNotification",
			"getEntitySchemas",
			"changeUserRelationships",
		] as const) {
			expect(selectSandboxHostFunctions(functions, input)).not.toHaveProperty(capability);
		}
		expect(selectSandboxHostFunctions(functions, input)).toHaveProperty("httpCall");
		expect(selectSandboxHostFunctions(functions, input)).toHaveProperty("getCachedValue");
	});
});

describe("isJsonValue", () => {
	it("uses the canonical cycle-safe JSON predicate", () => {
		const shared = { value: true };
		const cyclic: Record<string, unknown> = {};
		cyclic["self"] = cyclic;

		expect(isJsonValue({ nested: [true, 42, null] })).toBe(true);
		expect(isJsonValue({ left: shared, right: shared })).toBe(true);
		expect(isJsonValue(new Date(0))).toBe(false);
		expect(isJsonValue(Array(1))).toBe(false);
		expect(isJsonValue(cyclic)).toBe(false);
	});
});

const systemError = (tag: "Busy" | "NotFound" | "WouldBlock", cause?: unknown) =>
	PlatformError.systemError({
		_tag: tag,
		method: "spawn",
		module: "ChildProcessSpawner",
		...(cause === undefined ? {} : { cause }),
	});

describe("sandboxPlatformFailureKind", () => {
	it("treats exhausted platform resources as retryable and other failures as infrastructure", () => {
		expect(sandboxPlatformFailureKind(systemError("Busy"))).toBe("resource-unavailable");
		expect(sandboxPlatformFailureKind(systemError("WouldBlock"))).toBe("resource-unavailable");
		expect(sandboxPlatformFailureKind(systemError("NotFound", { code: "EMFILE" }))).toBe(
			"resource-unavailable",
		);
		expect(sandboxPlatformFailureKind(systemError("NotFound", { code: "ENOENT" }))).toBe(
			"infrastructure",
		);
		expect(sandboxPlatformFailureKind(new Error("boom"))).toBe("infrastructure");
	});
});
