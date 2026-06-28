import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./notification.sandbox";

const input = (signalSchemaSlug: string, properties: Record<string, string>): AutomationInput => ({
	automation: {
		ruleId: "rule-1",
		operation: "signal",
		origin: { kind: "api" },
		occurrenceId: "signal-1",
		occurredAt: "2026-07-20T10:00:00.000Z",
		source: {
			kind: "signal",
			signal: {
				properties,
				id: "signal-1",
				signalSchemaSlug,
				origin: { kind: "api" },
				occurredAt: "2026-07-20T10:00:00.000Z",
			},
		},
	},
});

it.each([
	["review.created", { entityName: "Dune" }, "Review posted for Dune"],
	["workout.created", { workoutName: "Morning Run" }, "Workout Morning Run was created"],
	[
		"integration.disabled",
		{ providerName: "komga" },
		"Integration komga has been disabled due to too many errors",
	],
] as const)("formats %s exclusively from the signal snapshot", (slug, properties, expected) => {
	const messages: string[] = [];
	return runSandboxTestDriver(
		definition.drivers.automation,
		input(slug, properties),
		defineSandboxTestHost(manifest, {
			sendNotification: (message) => {
				messages.push(message);
				return Promise.resolve({ data: null, success: true });
			},
		}),
		{ metadata: {}, sandboxScriptId: "script-1" },
	).then((result) => {
		expect(result).toEqual({ data: null, success: true });
		expect(messages).toEqual([expected]);
		return undefined;
	});
});

it("allowlists only notification delivery", () => {
	expect(manifest.capabilities).toEqual(["sendNotification"]);
});
