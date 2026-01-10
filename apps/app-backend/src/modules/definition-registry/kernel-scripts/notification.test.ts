import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { expect, it } from "vitest";

import definition, { manifest } from "./notification.sandbox";

const input = (
	signalSchemaSlug: string,
	properties: Record<string, JsonValue>,
): AutomationInput => ({
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
	[
		"integration.disabled",
		{ providerName: "komga" },
		"Integration komga has been disabled due to too many errors",
	],
])("formats %s exclusively from the signal snapshot", (slug, properties, expected) => {
	const messages: string[] = [];
	return Effect.runPromise(
		runSandboxTestDriver(
			definition.drivers.automation,
			input(slug, properties),
			defineSandboxTestHost(manifest, {
				sendNotification: (message) =>
					Effect.sync(() => {
						messages.push(message);
						return null;
					}),
			}),
			{ metadata: {}, sandboxScriptId: "script-1" },
		).pipe(
			Effect.tap((result) => {
				expect(result).toBeNull();
				expect(messages).toEqual([expected]);
			}),
		),
	);
});
