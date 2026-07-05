import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./notification.sandbox";

const input: AutomationInput = {
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
				signalSchemaSlug: "workout.created",
				occurredAt: "2026-07-20T10:00:00.000Z",
				properties: { workoutName: "Morning Run" },
			},
		},
	},
};

it("formats workout.created exclusively from the signal snapshot", () => {
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
		expect(messages).toEqual(["Workout Morning Run was created"]);
		return undefined;
	});
});
