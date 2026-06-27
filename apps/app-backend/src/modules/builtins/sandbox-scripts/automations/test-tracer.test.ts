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
		occurredAt: "2026-07-20T10:00:00.000Z",
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

it("emits a deterministic actor signal from the occurrence", () => {
	const calls: unknown[] = [];
	return runSandboxTestDriver(
		definition.drivers.automation,
		input,
		defineSandboxTestHost(manifest, {
			emitSignal: (request) => {
				calls.push(request);
				return Promise.resolve({
					success: true,
					data: { signalId: "signal-2", wasCreated: true },
				});
			},
		}),
		{ metadata: {}, sandboxScriptId: "script-1" },
	).then((result) => {
		expect(result).toEqual({
			success: true,
			data: { signalId: "signal-2", wasCreated: true },
		});
		expect(calls).toEqual([
			{
				discriminator: "signal-1",
				properties: { message: "trace" },
				schemaSlug: "automation.test-emitted",
			},
		]);
		return undefined;
	});
});
