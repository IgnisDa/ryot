import { automationInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { expect, it } from "vitest";

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
	Schema.decodeUnknownSync(automationInputSchema)({
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
	});

const eventCreateInput = (event: ReturnType<typeof workoutCompletedEvent>) =>
	input({ after: event, resource: "event", category: "change", operation: "create" });

const hostWithSignals = (calls: unknown[]) =>
	defineSandboxTestHost(manifest, {
		emitSignal: (request) => {
			calls.push(request);
			return Effect.succeed({ wasCreated: true, triggerId: "signal-1" });
		},
	});

it("emits a workout.created signal from a workout completion event", () => {
	const calls: unknown[] = [];
	return Effect.runPromise(
		definition.run(eventCreateInput(workoutCompletedEvent()), hostWithSignals(calls)).pipe(
			Effect.map((result) => {
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
				return result;
			}),
		),
	);
});

it("ignores workout entity creation and unrelated events", () => {
	const calls: unknown[] = [];
	const entityInput = input({
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
	const unrelatedEventInput = eventCreateInput(
		workoutCompletedEvent({ eventSchemaSlug: "workout-set" }),
	);

	return Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* definition.run(entityInput, hostWithSignals(calls))).toBeNull();
			expect(yield* definition.run(unrelatedEventInput, hostWithSignals(calls))).toBeNull();
			expect(calls).toEqual([]);
		}),
	);
});

it("ignores completion events with an invalid workout name", () => {
	const calls: unknown[] = [];
	const invalidInputs = [
		eventCreateInput(workoutCompletedEvent({ properties: { workoutName: "" } })),
		eventCreateInput(workoutCompletedEvent({ properties: { workoutName: 7 } })),
	];

	return Effect.runPromise(
		Effect.gen(function* () {
			for (const invalidInput of invalidInputs) {
				expect(yield* definition.run(invalidInput, hostWithSignals(calls))).toBeNull();
			}
			expect(calls).toEqual([]);
		}),
	);
});
