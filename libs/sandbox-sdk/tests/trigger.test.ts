import { describe, expect, test } from "bun:test";

import { defineManifest, SANDBOX_SCRIPT_DEFINITION } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import {
	afterCreateTriggerResultSchema,
	beforeCreateTriggerResultSchema,
	defineAfterCreateTrigger,
	defineBeforeCreateTrigger,
} from "@ryot/sandbox-sdk/trigger";

const beforeManifest = defineManifest({
	kind: "trigger",
	mode: "before_create",
	name: "Before trigger",
	requiredAppConfigKeys: [],
	slug: "trigger.before-test",
	capabilities: ["getCachedValue"],
});

describe("trigger definitions", () => {
	test("builds capability-checked before-create and after-create drivers", async () => {
		const before = defineBeforeCreateTrigger({
			manifest: beforeManifest,
			run: async (input, host) => {
				const cached = await host.getCachedValue(input.trigger.entityId);
				return cached.success ? { action: "allow" } : { action: "skip", reason: cached.error };
			},
		});
		const host = defineSandboxTestHost(beforeManifest, {
			getCachedValue: () => Promise.resolve({ data: null, success: true }),
		});
		const result = await runSandboxTestDriver(
			before.drivers.trigger,
			{
				trigger: {
					origin: "api",
					properties: {},
					userId: "user-1",
					entityId: "entity-1",
					phase: "before_create",
					entitySchemaSlug: "movie",
					eventSchemaSlug: "progress",
					eventSchemaId: "event-schema-1",
					entitySchemaId: "entity-schema-1",
					occurredAt: "2026-01-01T00:00:00.000Z",
				},
			},
			host,
			{ metadata: {}, sandboxScriptId: "script-1" },
		);

		expect(before.definitionType).toBe(SANDBOX_SCRIPT_DEFINITION);
		expect(result).toEqual({ action: "allow" });

		const afterManifest = defineManifest({
			kind: "trigger",
			capabilities: [],
			mode: "after_create",
			name: "After trigger",
			requiredAppConfigKeys: [],
			slug: "trigger.after-test",
		});
		const after = defineAfterCreateTrigger({
			manifest: afterManifest,
			run: () => Promise.resolve(),
		});
		expect(after.drivers.trigger.output.parse(undefined)).toBeUndefined();
	});
});

describe("trigger result contracts", () => {
	test("accepts every before-create action and rejects malformed actions", () => {
		expect(beforeCreateTriggerResultSchema.parse({ action: "allow" })).toEqual({ action: "allow" });
		expect(
			beforeCreateTriggerResultSchema.parse({ action: "skip", reason: "not applicable" }),
		).toEqual({ action: "skip", reason: "not applicable" });
		expect(
			beforeCreateTriggerResultSchema.parse({
				action: "replace",
				body: { properties: { progressPercent: 100 }, sessionEntityId: null },
			}),
		).toEqual({
			action: "replace",
			body: { properties: { progressPercent: 100 }, sessionEntityId: null },
		});
		expect(beforeCreateTriggerResultSchema.safeParse({ action: "skip" }).success).toBe(false);
		expect(beforeCreateTriggerResultSchema.safeParse({ action: "unknown" }).success).toBe(false);
	});

	test("accepts only an absent after-create result", () => {
		expect(afterCreateTriggerResultSchema.safeParse(undefined).success).toBe(true);
		expect(afterCreateTriggerResultSchema.safeParse(null).success).toBe(false);
		expect(afterCreateTriggerResultSchema.safeParse({ action: "allow" }).success).toBe(false);
	});
});
