import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./test-tracer.sandbox";

const input = {
	automation: {
		ruleId: "rule-1",
		operation: "signal",
		origin: { kind: "api" },
		occurrenceId: "signal-1",
		source: {
			kind: "signal",
			signal: {
				id: "signal-1",
				origin: { kind: "api" },
				properties: { message: "trace" },
				occurredAt: "2026-07-20T10:00:00.000Z",
				signalSchemaSlug: "automation.test-tracer",
			},
		},
	},
} as const satisfies AutomationInput;

it("returns stable tracer identifiers from automation context", () =>
	runSandboxTestDriver(definition.drivers.automation, input, defineSandboxTestHost(manifest, {}), {
		metadata: {},
		sandboxScriptId: "script-1",
	}).then((result) => {
		expect(result).toEqual({ ruleId: "rule-1", occurrenceId: "signal-1" });
		return undefined;
	}));
