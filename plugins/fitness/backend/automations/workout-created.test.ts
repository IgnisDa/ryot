import { automationInputSchema } from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import { fitnessPlugin } from "../../host/plugin";
import definition, { manifest } from "./workout-created.sandbox";

it("emits an actor signal from the inline workout snapshot", async () => {
	const calls: unknown[] = [];
	const input = Schema.decodeUnknownSync(automationInputSchema)({
		automation: {
			runId: "run-1",
			triggerId: "trigger-1",
			executionUserId: "user-1",
			hookSlug: "fitness.workout-created",
			occurredAt: "2026-07-20T10:00:00.000Z",
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: "user-1" },
			},
			payload: {
				category: "change",
				resource: "entity",
				operation: "create",
				after: {
					properties: {},
					id: "workout-1",
					externalId: null,
					providerId: null,
					populatedAt: null,
					name: "Morning Run",
					entitySchemaSlug: "workout",
					createdAt: "2026-07-20T10:00:00.000Z",
					updatedAt: "2026-07-20T10:00:00.000Z",
				},
			},
		},
	});
	await Effect.runPromise(
		definition.run(
			input,
			defineSandboxTestHost(manifest, {
				emitSignal: (request) => {
					calls.push(request);
					return Effect.succeed({ wasCreated: true, triggerId: "signal-1" });
				},
			}),
			{ metadata: {}, sandboxScriptId: "script-1" },
		),
	);
	expect(calls).toEqual([
		{
			discriminator: "workout-1",
			schemaSlug: "workout.created",
			properties: { workoutId: "workout-1", workoutName: "Morning Run" },
		},
	]);
	const hook = fitnessPlugin.hooks.find(({ slug }) => slug === "fitness.workout-created");
	expect(hook).toMatchObject({ causationSources: ["api"] });
});
