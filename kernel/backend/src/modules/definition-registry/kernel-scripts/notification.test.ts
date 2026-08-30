import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./notification.sandbox";

const input = (occurrenceId = "occurrence-1"): AutomationInput => ({
	automation: {
		occurrenceId,
		ruleId: "rule-1",
		operation: "signal",
		origin: { kind: "api" },
		occurredAt: "2026-07-20T10:00:00.000Z",
		source: { kind: "signal", signalId: "signal-1" },
	},
});

const occurrenceResponse = (signalSchemaSlug: string, properties: Record<string, JsonValue>) => ({
	data: {
		occurrences: {
			type: "rows" as const,
			pageInfo: { limit: 1, hasMore: false, nextCursor: null },
			items: [
				{
					population: null,
					operation: "signal",
					origin: { kind: "api" },
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
			],
		},
	},
});

it.each([
	[
		"integration.disabled",
		{ providerName: "theta" },
		"Integration theta has been disabled due to too many errors",
	],
])("formats %s from the signal occurrence", (slug, properties, expected) => {
	const messages: string[] = [];
	return Effect.runPromise(
		definition.run(
			input(),
			defineSandboxTestHost(manifest, {
				executeRyotql: () => Effect.succeed(occurrenceResponse(slug, properties)),
				sendNotification: (message) =>
					Effect.sync(() => {
						messages.push(message);
						return null;
					}),
			}),
			{ metadata: {}, sandboxScriptId: "script-1" },
		),
	).then((result) => {
		expect(result).toBeNull();
		return expect(messages).toEqual([expected]);
	});
});
