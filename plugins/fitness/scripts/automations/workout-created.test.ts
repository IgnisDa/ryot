import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./workout-created.sandbox";

const input = (origin: AutomationInput["automation"]["origin"]): AutomationInput => ({
	automation: {
		origin,
		ruleId: "rule-1",
		operation: "create",
		occurrenceId: "occurrence-1",
		occurredAt: "2026-07-20T10:00:00.000Z",
		source: {
			kind: "entity",
			after: {
				properties: {},
				id: "workout-1",
				name: "Morning Run",
				entitySchemaSlug: "workout",
			},
		},
	},
});

const execution = { metadata: {}, sandboxScriptId: "script-1" };

it("emits one actor signal for an API workout from its entity snapshot", () => {
	const calls: unknown[] = [];
	return Effect.runPromise(
		definition.run(
			input({ kind: "api" }),
			defineSandboxTestHost(manifest, {
				emitSignal: (request) => {
					calls.push(request);
					return Effect.succeed({ signalId: "signal-1", wasCreated: true });
				},
			}),
			execution,
		),
	).then((result) => {
		expect(result).toEqual({ signalId: "signal-1", wasCreated: true });
		expect(calls).toEqual([
			{
				discriminator: "workout-1",
				schemaSlug: "workout.created",
				properties: { workoutId: "workout-1", workoutName: "Morning Run" },
			},
		]);
		return undefined;
	});
});

it.each([
	{ kind: "bootstrap" } as const,
	{ kind: "provider_refresh" } as const,
	{ kind: "import", importRunId: "import-1" } as const,
	{ kind: "automation", executionId: "execution-1" } as const,
	{ kind: "integration", integrationId: "integration-1" } as const,
])("does not emit for the $kind origin", (origin) => {
	const calls: unknown[] = [];
	return Effect.runPromise(
		definition.run(
			input(origin),
			defineSandboxTestHost(manifest, {
				emitSignal: (request) => {
					calls.push(request);
					return Effect.succeed({ signalId: "signal-1", wasCreated: true });
				},
			}),
			execution,
		),
	).then((result) => {
		expect(result).toBeNull();
		expect(calls).toEqual([]);
		return undefined;
	});
});
