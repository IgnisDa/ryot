import { describe, expect, it } from "bun:test";

import { createListedEntity, createWorkoutSetPropertiesSchema } from "~/lib/test-fixtures";
import type { CreateEventBulkBody } from "~/modules/events";

import type { WorkoutAdapterResult } from "./sources/workout";
import {
	processWorkoutImportResultWithDeps,
	type WorkoutImportProcessorDeps,
} from "./workout-processor";

const emptyPropertiesSchema = { fields: {} };

const createDeps = (input: {
	calls: string[];
	createdEvents: CreateEventBulkBody[];
	runUpdates: Array<Record<string, unknown>>;
	createdExercises: Array<Record<string, unknown>>;
}): WorkoutImportProcessorDeps => ({
	createImportRunFailure: () => Promise.resolve(),
	getBuiltinEventSchemaBySlug: () =>
		Promise.resolve({
			name: "Workout Set",
			id: "event_schema_workout_set",
			propertiesSchema: createWorkoutSetPropertiesSchema(),
		}),
	getBuiltinEntitySchemaBySlug: (slug) =>
		Promise.resolve(
			slug === "exercise"
				? { id: "schema_exercise", propertiesSchema: emptyPropertiesSchema }
				: { id: "schema_workout", propertiesSchema: emptyPropertiesSchema },
		),
	listEntityMatchCandidates: () =>
		Promise.resolve({
			data: [
				{
					userId: null,
					...createListedEntity({
						name: "Bench Press",
						id: "exercise_existing_bench",
						entitySchemaId: "schema_exercise",
						properties: { kind: "reps_and_weight" },
					}),
				},
			],
		}),
	createEntity: ({ body }) => {
		if (body.entitySchemaId === "schema_exercise") {
			input.calls.push(`create:exercise:${body.name}`);
			input.createdExercises.push(body.properties);
			return Promise.resolve({
				data: createListedEntity({
					name: body.name,
					properties: body.properties,
					entitySchemaId: body.entitySchemaId,
					id: `exercise_custom_${input.createdExercises.length}`,
				}),
			});
		}

		input.calls.push(`create:workout:${body.name}`);
		return Promise.resolve({
			data: createListedEntity({
				name: body.name,
				properties: body.properties,
				entitySchemaId: body.entitySchemaId,
				id: `workout_${input.calls.filter((call) => call.startsWith("create:workout")).length}`,
			}),
		});
	},
	createEventsWithTriggers: ({ body }) => {
		input.calls.push(`events:${body.length}`);
		input.createdEvents.push(body);
		return Promise.resolve({ data: { count: body.length, createdEvents: [] } });
	},
	updateImportRun: (update) => {
		input.runUpdates.push(update);
		return Promise.resolve();
	},
});

describe("processWorkoutImportResult", () => {
	it("reuses exercises, creates custom exercises, and writes derived workout-set events", async () => {
		const calls: string[] = [];
		const createdEvents: CreateEventBulkBody[] = [];
		const runUpdates: Array<Record<string, unknown>> = [];
		const createdExercises: Array<Record<string, unknown>> = [];
		const adapterResult: WorkoutAdapterResult = {
			failures: [],
			items: [
				{
					itemIndex: 0,
					name: "Workout A",
					comment: "Felt good",
					sourceIdentifier: "w1",
					sourceLabel: "Workout A",
					endedAt: "2026-01-01T11:00:00.000Z",
					startedAt: "2026-01-01T10:00:00.000Z",
					exercises: [
						{
							name: "bench press",
							kind: "reps_and_weight",
							sets: [{ setLot: "normal", reps: 5, weight: 100 }],
						},
						{
							name: "Run",
							kind: "distance_and_duration",
							sets: [{ setLot: "normal", distance: 5, duration: 1800 }],
						},
					],
				},
				{
					itemIndex: 1,
					comment: null,
					name: "Workout B",
					sourceLabel: "Workout B",
					sourceIdentifier: "w2",
					endedAt: "2026-01-02T11:00:00.000Z",
					startedAt: "2026-01-02T10:00:00.000Z",
					exercises: [
						{
							name: "RUN",
							kind: "distance_and_duration",
							sets: [{ setLot: "normal", distance: 3, duration: 1200 }],
						},
					],
				},
			],
		};

		await processWorkoutImportResultWithDeps(
			{ adapterResult, runId: "run_1", userId: "user_1" },
			createDeps({ calls, runUpdates, createdEvents, createdExercises }),
		);

		expect(calls).toEqual([
			"create:exercise:Run",
			"create:workout:Workout A",
			"events:2",
			"create:workout:Workout B",
			"events:1",
		]);
		expect(createdExercises).toEqual([
			{ kind: "distance_and_duration", images: [], muscles: [], instructions: [] },
		]);

		const firstWorkoutEvents = createdEvents[0] ?? [];
		expect(firstWorkoutEvents[0]).toMatchObject({
			entityId: "exercise_existing_bench",
			sessionEntityId: "workout_1",
			occurredAt: "2026-01-01T10:00:00.000Z",
			eventSchemaId: "event_schema_workout_set",
			properties: {
				reps: 5,
				volume: 500,
				setOrder: 0,
				weight: 100,
				oneRm: 112.5,
				setLot: "normal",
				exerciseOrder: 0,
			},
		});
		expect(firstWorkoutEvents[1]).toMatchObject({
			sessionEntityId: "workout_1",
			entityId: "exercise_custom_1",
			properties: {
				distance: 5,
				setOrder: 0,
				duration: 1800,
				setLot: "normal",
				exerciseOrder: 1,
			},
		});
		expect(Number(firstWorkoutEvents[1]?.properties.pace)).toBeCloseTo(5 / 1800, 5);

		const secondWorkoutEvents = createdEvents[1] ?? [];
		expect(secondWorkoutEvents[0]).toMatchObject({
			sessionEntityId: "workout_2",
			entityId: "exercise_custom_1",
			occurredAt: "2026-01-02T10:00:00.000Z",
		});
		expect(runUpdates.at(-1)).toMatchObject({
			progress: 100,
			failedItems: 0,
			importedItems: 2,
			processedItems: 2,
			status: "completed",
		});
	});
});
