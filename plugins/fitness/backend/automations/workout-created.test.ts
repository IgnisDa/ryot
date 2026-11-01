import { expect, it } from "@effect/vitest";
import { automationInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import { fitnessPlugin } from "../../manifest/plugin";
import definition, { manifest } from "./workout-created.sandbox";

const timestamp = "2026-07-20T10:00:00.000Z";

const workoutCompletedEvent = (overrides: Record<string, unknown> = {}) => ({
	id: "event-1",
	createdAt: timestamp,
	updatedAt: timestamp,
	entityId: "workout-1",
	occurredAt: timestamp,
	sessionEntityId: null,
	entitySchemaSlug: "workout",
	eventSchemaSlug: "workout-completed",
	eventSchemaPluginId: "fitness-owner",
	entitySchemaPluginId: "fitness-owner",
	properties: { workoutName: "Morning Run" },
	...overrides,
});

const input = (payload: unknown) =>
	Schema.decodeUnknownEffect(automationInputSchema)({
		automation: {
			payload,
			runId: "run-1",
			occurredAt: timestamp,
			triggerId: "trigger-1",
			executionUserId: "user-1",
			hookSlug: "fitness.workout-created",
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				lane: "interactive",
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: "user-1" },
			},
		},
	}).pipe(Effect.orDie);

const eventCreateInput = (event: ReturnType<typeof workoutCompletedEvent>) =>
	input({ after: event, resource: "event", category: "change", operation: "create" });

const hostWithSignals = (calls: unknown[]) =>
	defineSandboxTestHost(manifest, {
		emitSignal: (request) => {
			calls.push(request);
			return Effect.succeed({ wasCreated: true, triggerId: "signal-1" });
		},
	});

it.effect("emits a workout.created signal from a workout completion event", () =>
	Effect.gen(function* () {
		const calls: unknown[] = [];
		yield* definition.run(yield* eventCreateInput(workoutCompletedEvent()), hostWithSignals(calls));
		expect(calls).toEqual([
			{
				discriminator: "workout-1",
				schemaSlug: "workout.created",
				properties: { workoutId: "workout-1", workoutName: "Morning Run" },
			},
		]);
		const hook = fitnessPlugin.hooks.find(({ slug }) => slug === "fitness.workout-created");
		expect(hook).toMatchObject({
			causationSources: ["api"],
			targets: [
				{
					resource: "event",
					operation: "create",
					entitySchemaSlug: "workout",
					eventSchemaSlug: "workout-completed",
				},
			],
		});
		expect(manifest.inputProjection.event).toEqual({
			compareProperties: [],
			properties: ["workoutName"],
		});
	}),
);

it.effect("ignores workout entity creation and unrelated events", () =>
	Effect.gen(function* () {
		const calls: unknown[] = [];
		const entityInput = yield* input({
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
				createdAt: timestamp,
				updatedAt: timestamp,
				entitySchemaSlug: "workout",
				entitySchemaPluginId: "fitness-owner",
			},
		});
		const unrelatedEventInput = yield* eventCreateInput(
			workoutCompletedEvent({ eventSchemaSlug: "workout-set" }),
		);
		expect(yield* definition.run(entityInput, hostWithSignals(calls))).toBeNull();
		expect(yield* definition.run(unrelatedEventInput, hostWithSignals(calls))).toBeNull();
		expect(calls).toEqual([]);
	}),
);

it.effect("ignores completion events with an invalid workout name", () =>
	Effect.gen(function* () {
		const calls: unknown[] = [];
		for (const invalidInput of [
			yield* eventCreateInput(workoutCompletedEvent({ properties: { workoutName: "" } })),
			yield* eventCreateInput(workoutCompletedEvent({ properties: { workoutName: 7 } })),
		]) {
			expect(yield* definition.run(invalidInput, hostWithSignals(calls))).toBeNull();
		}
		expect(calls).toEqual([]);
	}),
);
