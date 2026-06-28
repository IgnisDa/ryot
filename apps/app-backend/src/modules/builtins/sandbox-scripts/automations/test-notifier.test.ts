import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./test-notifier.sandbox";

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
				occurredAt: "2026-07-20T10:00:00.000Z",
				signalSchemaSlug: "automation.test-emitted",
				properties: { message: "A review was created" },
			},
		},
	},
} as const satisfies AutomationInput;

it("sends a notification formatted from the signal snapshot", () => {
	const messages: string[] = [];
	return runSandboxTestDriver(
		definition.drivers.automation,
		input,
		defineSandboxTestHost(manifest, {
			sendNotification: (message) => {
				messages.push(message);
				return Promise.resolve({ data: null, success: true });
			},
		}),
		{ metadata: {}, sandboxScriptId: "script-1" },
	).then((result) => {
		expect(result).toEqual({ data: null, success: true });
		expect(messages).toEqual(["A review was created"]);
		return undefined;
	});
});
