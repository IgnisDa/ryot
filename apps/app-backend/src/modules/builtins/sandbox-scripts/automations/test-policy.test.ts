import type { AutomationPolicyInput } from "@ryot/sandbox-sdk/automation";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import definition, { manifest } from "./test-policy.sandbox";

const input = (testPolicyAction: string) =>
	({
		automation: {
			ruleId: "rule-1",
			operation: "create" as const,
			occurrenceId: "occurrence-1",
			origin: { kind: "api" as const },
			source: {
				kind: "event" as const,
				draft: {
					entityId: "entity-1",
					entitySchemaSlug: "book",
					eventSchemaSlug: "review",
					eventSchemaId: "event-schema-1",
					properties: { testPolicyAction },
					entitySchemaId: "entity-schema-1",
					occurredAt: "2026-01-01T00:00:00.000Z",
				},
			},
		},
	}) satisfies AutomationPolicyInput;

const runPolicy = (testPolicyAction: string) =>
	runSandboxTestDriver(
		definition.drivers.automation,
		input(testPolicyAction),
		defineSandboxTestHost(manifest, {}),
		{ metadata: {}, sandboxScriptId: "script-1" },
	);

describe("automation test policy sandbox script", () => {
	it("allows, skips, and replaces drafts", () =>
		Promise.all([runPolicy("allow"), runPolicy("skip"), runPolicy("replace")]).then(
			([allowed, skipped, replaced]) => {
				expect(allowed).toEqual({ action: "allow" });
				expect(skipped).toEqual({
					action: "skip",
					reason: "Skipped by the automation test policy",
				});
				expect(replaced).toEqual({
					action: "replace",
					body: { properties: { testPolicyAction: "replaced" } },
				});
				return undefined;
			},
		));
});
