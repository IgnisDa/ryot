import { automationInputSchema } from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import definition, { manifest } from "./workout-context-changed.sandbox";

const timestamp = "2026-01-01T08:00:00.000Z";

const input = (
	entitySchemaSlug: string,
	property: string,
	beforeValue: unknown,
	afterValue: unknown,
) =>
	Schema.decodeSync(automationInputSchema)({
		automation: {
			runId: "run-1",
			occurredAt: timestamp,
			triggerId: "trigger-1",
			executionUserId: "user-1",
			hookSlug: "fitness.workout-context-changed",
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
				operation: "update",
				changedProperties: beforeValue === afterValue ? [] : [property],
				after: {
					id: "entity-1",
					name: "Entity",
					properties: {},
					entitySchemaSlug,
					externalId: null,
					providerId: null,
					populatedAt: null,
					createdAt: timestamp,
					updatedAt: timestamp,
				},
				before: {
					id: "entity-1",
					name: "Entity",
					properties: {},
					entitySchemaSlug,
					externalId: null,
					providerId: null,
					populatedAt: null,
					createdAt: timestamp,
					updatedAt: timestamp,
				},
			},
		},
	});

const run = (automationInput: ReturnType<typeof input>) => {
	const emissions: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		emitSignal: (request) => {
			emissions.push(request);
			return Effect.succeed({ wasCreated: true, triggerId: `signal-${emissions.length}` });
		},
	});
	return definition.run(automationInput, host).pipe(Effect.as(emissions));
};

describe("workout context change detector", () => {
	it.each([
		["exercise", "kind", "strength", "cardio", "exercise.context-changed"],
		[
			"workout",
			"startedAt",
			"2026-01-01T08:00:00.000Z",
			"2026-01-02T08:00:00.000Z",
			"workout.context-changed",
		],
	] as const)("emits %s context changes", (schemaSlug, property, beforeValue, afterValue, schema) =>
		Effect.runPromise(
			run(input(schemaSlug, property, beforeValue, afterValue)).pipe(
				Effect.map((emissions) => {
					expect(emissions).toEqual([
						{
							properties: {},
							schemaSlug: schema,
							discriminator: "entity-1",
							subjectEntityId: "entity-1",
						},
					]);
				}),
			),
		),
	);

	it("compares only the declared entity context properties", () => {
		expect(manifest.inputProjection.entity).toEqual({
			properties: [],
			parentEntityProperties: [],
			compareProperties: [
				{ equality: "json", property: "kind" },
				{ equality: "json", property: "startedAt" },
			],
		});
	});

	it("ignores unchanged values, unrelated properties, and other entity schemas", () =>
		Effect.runPromise(
			Effect.all([
				run(input("exercise", "kind", "strength", "strength")),
				run(input("workout", "startedAt", timestamp, timestamp)),
				run(input("exercise", "name", "Before", "After")),
				run(input("measurement", "startedAt", timestamp, "2026-01-02T08:00:00.000Z")),
			]).pipe(
				Effect.map((emissions) => {
					expect(emissions).toEqual([[], [], [], []]);
				}),
			),
		));
});
