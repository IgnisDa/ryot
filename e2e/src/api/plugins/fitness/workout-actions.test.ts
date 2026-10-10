import { workoutEditorEntityRecipe } from "@ryot-app/fitness-plugin/workout-editor-recipes";
import { collectionPickerRecipe } from "@ryot-app/ryotql-recipes/collections";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	getEntity,
	listEventsForEntity,
	pollUntil,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	createMeasurementReadingFixture,
	createWorkoutEntityFixture,
	createWorkoutTemplateEntityFixture,
	deleteWorkout,
	findWorkoutSetEventSchema,
	LARGE_WORKOUT_BUDGET,
	readWorkoutDetails,
	seedExerciseWorkout,
} from "~/fixtures/plugins/fitness";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { expect, it } from "~/support/effect-test";

it.live(
	"deletes all 101 session sets, preserves related entities, and recomputes surviving records",
	() =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const { workoutTemplateId } = yield* createWorkoutTemplateEntityFixture(client);
			const { metricId } = yield* createMeasurementReadingFixture(client);
			const measurements = yield* listEventsForEntity(client, metricId, undefined, 100);
			const older = yield* createWorkoutEntityFixture(client, {
				name: "Historical record workout",
				endedAt: "2026-06-01T11:00:00.000Z",
				startedAt: "2026-06-01T10:00:00.000Z",
			});
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
			const response = yield* client.call((c) =>
				c.events.create({
					payload: Array.from({ length: 101 }, (_, setOrder) => ({
						entityId: exerciseId,
						sessionEntityId: older.workoutId,
						occurredAt: "2026-06-01T10:05:00.000Z",
						eventSchemaSlug: workoutSetEventSchema.id,
						properties: {
							setOrder,
							reps: 20,
							weight: 100,
							exerciseOrder: 0,
							confirmedAt: "2026-06-01T10:05:00.000Z",
						},
					})),
				}),
			);
			expect(
				(yield* waitForCreateEvents(client, response, LARGE_WORKOUT_BUDGET.eventsMs)).count,
			).toBe(101);
			const newer = yield* seedExerciseWorkout(client, {
				exerciseId,
				name: "Surviving workout",
				endedAt: "2026-06-02T11:00:00.000Z",
				startedAt: "2026-06-02T10:00:00.000Z",
				sets: [
					{
						occurredAt: "2026-06-02T10:05:00.000Z",
						properties: { reps: 10, weight: 50, confirmedAt: "2026-06-02T10:05:00.000Z" },
					},
				],
			});
			expect(
				(yield* readWorkoutDetails(client, older.workoutId)).exercises.items.flatMap(
					({ sets }) => sets.items,
				),
			).toHaveLength(101);
			const collection = yield* client.call((c) =>
				c.collections.create({ payload: { name: "Workout archive" } }),
			);
			yield* client.call((c) =>
				c.collections.createMembership({
					payload: {
						mode: "add-if-absent",
						entityId: older.workoutId,
						collectionId: collection.id,
					},
				}),
			);
			expect(
				(yield* executeRyotQLRecipe(
					client,
					collectionPickerRecipe({ entityId: older.workoutId, search: "Workout archive" }),
				)).items,
			).toContainEqual({ added: true, id: collection.id, name: collection.name });
			const entity = yield* getEntity(client, older.workoutId);
			const pluginId = requirePresent(entity.entitySchemaPluginId, "Expected workout plugin");
			const submission = {
				entityId: older.workoutId,
				submissionId: crypto.randomUUID(),
				submittedAt: "2026-10-18T10:00:00.000Z",
			};
			expect(yield* deleteWorkout(client, submission)).toEqual({ entityId: older.workoutId });
			expect(yield* deleteWorkout(client, submission)).toEqual({ entityId: older.workoutId });
			expect(
				yield* executeRyotQLRecipe(
					client,
					workoutEditorEntityRecipe({
						kind: "workout",
						entityId: older.workoutId,
						reference: { pluginId, kind: "local" },
					}),
				),
			).toBeNull();
			expect((yield* getEntity(client, exerciseId)).id).toBe(exerciseId);
			expect((yield* getEntity(client, workoutTemplateId)).id).toBe(workoutTemplateId);
			expect((yield* getEntity(client, collection.id)).id).toBe(collection.id);
			expect(yield* listEventsForEntity(client, metricId, undefined, 100)).toEqual(measurements);
			const events = yield* listEventsForEntity(client, exerciseId, undefined, 100);
			expect(events.filter(({ sessionEntityId }) => sessionEntityId === older.workoutId)).toEqual(
				[],
			);
			const recomputed = yield* pollUntil(
				"records after workout deletion",
				readWorkoutDetails(client, newer.workoutId).pipe(
					Effect.map((workout) => {
						const set = workout.exercises.items[0]?.sets.items[0];
						return set?.recordStatus === "ready" && set.personalBests?.includes("weight")
							? set
							: null;
					}),
				),
				120000,
			);
			expect(recomputed.personalBests).toEqual(["reps", "one_rm", "volume", "weight"]);
			const options = yield* executeRyotQLRecipe(
				client,
				collectionPickerRecipe({ entityId: older.workoutId, search: "Workout archive" }),
			);
			expect(options.items).toContainEqual({
				added: false,
				id: collection.id,
				name: collection.name,
			});
		}),
	LARGE_WORKOUT_BUDGET.testMs,
);

it.live("rejects deletion of another user's workout and of an exercise", () =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const { client: other } = yield* createAuthenticatedClient();
		const { exerciseId } = yield* createExerciseEntityFixture(client);
		const { workoutId } = yield* createWorkoutEntityFixture(client, { name: "Private workout" });
		const submission = {
			submissionId: crypto.randomUUID(),
			submittedAt: "2026-10-18T10:00:00.000Z",
		};
		const foreign = yield* deleteWorkout(other, { ...submission, entityId: workoutId }).pipe(
			Effect.flip,
		);
		assertTaggedError(foreign, "PluginInvocationError");
		expect(foreign.reason.code).toBe("runtime-failed");
		const wrongSchema = yield* deleteWorkout(client, { ...submission, entityId: exerciseId }).pipe(
			Effect.flip,
		);
		assertTaggedError(wrongSchema, "PluginInvocationError");
		expect(wrongSchema.reason.code).toBe("runtime-failed");
		expect((yield* getEntity(client, workoutId)).id).toBe(workoutId);
		expect((yield* getEntity(client, exerciseId)).id).toBe(exerciseId);
	}),
);
