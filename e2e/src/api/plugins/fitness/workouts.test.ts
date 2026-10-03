import { builtinSavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { workoutListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import {
	workoutCardsRecipe,
	workoutComparisonsRecipe,
	workoutCountRecipe,
	workoutSummaryRecipe,
	workoutWeeksRecipe,
} from "@ryot-app/fitness-plugin/workout-list-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	executeRyotQLRecipe,
	getEntity,
	insertRelationshipRow,
	listSavedViews,
	waitForCreateEvents,
	waitForEventCount,
	uploadPermanentAsset,
} from "~/fixtures/kernel";
import {
	createWorkoutEntityFixture,
	createExerciseEntityFixture,
	createWorkoutTemplateEntityFixture,
	findFitnessEntitySchema,
	findFitnessRelationshipSchema,
	findWorkoutSetEventSchema,
	waitForSessionEventCount,
} from "~/fixtures/plugins/fitness";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Workouts E2E", () => {
	it.live("links the built-in workout schema to the fitness plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId, schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");

			expect(workoutSchema.name).toBe("Workout");
			expect(workoutSchema.pluginId).toBe(pluginId);
			expect(workoutSchema.isBuiltin).toBe(true);
		}),
	);

	it.live("exposes the workout schema properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);

			expect(workoutSchema.propertiesSchema.fields).toMatchObject({
				exerciseMedia: { type: "array" },
				images: { type: "array", label: "Images", description: "Images attached to this workout" },
				videos: { type: "array", label: "Videos", description: "Videos attached to this workout" },
				endedAt: {
					type: "datetime",
					label: "Ended At",
					description: "Date and time this workout session ended",
				},
				comment: {
					type: "string",
					label: "Comment",
					description: "Optional notes or comments about this workout",
				},
				startedAt: {
					type: "datetime",
					label: "Started At",
					description: "Date and time this workout session began",
				},
				caloriesBurnt: {
					type: "number",
					label: "Calories Burnt",
					description: "Estimated energy burned during this workout in kilocalories (kcal)",
				},
			});
			expect(workoutSetEventSchema.propertiesSchema.fields).not.toHaveProperty("images");
			expect(workoutSetEventSchema.propertiesSchema.fields).not.toHaveProperty("videos");
		}),
	);

	it.live("rejects a workout without a start time", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entities.create({
						payload: {
							properties: {},
							name: "Workout without start",
							entitySchema: workoutSchema.reference,
						},
					}),
				),
			);

			assertTaggedError(error, "EntityBadRequest");
			expect(error.reason).toMatchObject({ code: "invalid-properties" });
		}),
	);

	it.live("rejects invalid recorded duration and energy without inventing unknown values", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");
			const startedAt = "2026-04-27T10:00:00Z";
			for (const properties of [
				{ startedAt, activeDuration: -1 },
				{ startedAt, activeDuration: 1.5 },
				{ startedAt, caloriesBurnt: -1 },
			]) {
				const error = yield* Effect.flip(
					createEntity(client, {
						properties,
						name: "Invalid workout",
						entitySchema: workoutSchema.reference,
					}),
				);
				assertTaggedError(error, "EntityBadRequest");
				expect(error.reason.code).toBe("invalid-properties");
			}
			const workout = yield* createEntity(client, {
				properties: { startedAt },
				name: "Unknown duration workout",
				entitySchema: workoutSchema.reference,
			});
			const stored = yield* getEntity(client, workout.id);
			expect(stored.properties).not.toHaveProperty("activeDuration");
			expect(stored.properties).not.toHaveProperty("caloriesBurnt");
		}),
	);

	it.live(
		"persists normalized workout media and recorded duration independently of elapsed time",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schema: workoutSchema } = yield* findFitnessEntitySchema(client, "workout");
				const video = yield* uploadPermanentAsset(client, {
					fileName: "workout.mp4",
					contentType: "video/mp4",
				});
				const image = yield* uploadPermanentAsset(client, {
					fileName: "workout.jpg",
					contentType: "image/jpeg",
				});
				const exerciseVideo = yield* uploadPermanentAsset(client, {
					fileName: "exercise.mp4",
					contentType: "video/mp4",
				});
				const workout = yield* createEntity(client, {
					entitySchema: workoutSchema.reference,
					name: `Workout ${crypto.randomUUID()}`,
					properties: {
						videos: [video],
						images: [image],
						caloriesBurnt: 150,
						activeDuration: 2400,
						endedAt: "2026-04-27T11:00:00Z",
						startedAt: "2026-04-27T10:00:00Z",
						exerciseMedia: [
							{
								exerciseOrder: 0,
								videos: [exerciseVideo],
								images: [{ type: "remote", url: "https://example.com/exercise.jpg" }],
							},
						],
					},
				});
				const entity = yield* getEntity(client, workout.id);

				expect(entity.properties).toMatchObject({
					videos: [video],
					images: [image],
					caloriesBurnt: 150,
					activeDuration: 2400,
					endedAt: "2026-04-27T11:00:00Z",
					startedAt: "2026-04-27T10:00:00Z",
					exerciseMedia: [
						{
							exerciseOrder: 0,
							videos: [exerciseVideo],
							images: [{ type: "remote", url: "https://example.com/exercise.jpg" }],
						},
					],
				});
			}),
	);

	it.live("renders the built-in All Workouts saved view with the workouts page", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findFitnessEntitySchema(client, "workout");
			const views = yield* listSavedViews(client, { pluginId });

			expect(views.find((view) => view.name === "All Workouts")).toMatchObject({
				settings: {},
				isBuiltin: true,
				dataSources: null,
				name: "All Workouts",
				renderer: { kind: "plugin", exportName: "workouts" },
				reference: builtinSavedViewReference(pluginId, "all-workouts"),
			});
		}),
	);

	it.live("pages workout cards newest first with server totals, origins and period totals", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findFitnessEntitySchema(client, "workout");
			const reference = { pluginId, kind: "local" as const };
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
			const { exerciseId } = yield* createExerciseEntityFixture(client, {
				kind: "reps_and_weight",
			});
			const workout = (name: string, day: string, weights: readonly number[]) =>
				Effect.gen(function* () {
					const { workoutId } = yield* createWorkoutEntityFixture(client, {
						name,
						endedAt: `${day}T11:00:00Z`,
						startedAt: `${day}T10:00:00Z`,
					});
					if (weights.length > 0) {
						yield* client.call((c) =>
							c.events.create({
								payload: weights.map((weight, setOrder) => ({
									entityId: exerciseId,
									sessionEntityId: workoutId,
									eventSchemaSlug: workoutSetEventSchema.id,
									properties: { weight, reps: 5, setOrder, setLot: "normal", exerciseOrder: 0 },
								})),
							}),
						);
						yield* waitForSessionEventCount(client, workoutId, weights.length);
					}
					return workoutId;
				});
			const firstPull = yield* workout("Pull", "2026-10-01", [80]);
			const legs = yield* workout("Legs", "2026-10-07", [100]);
			const secondPull = yield* workout("Pull", "2026-10-08", []);
			const repeatedLegs = yield* workout("Legs", "2026-10-14", [110, 100]);
			const { workoutTemplateId } = yield* createWorkoutTemplateEntityFixture(client, {
				name: "Pull B",
			});
			const repeatedFrom = yield* findFitnessRelationshipSchema(client, "workout-repeated-from");
			const fromTemplate = yield* findFitnessRelationshipSchema(
				client,
				"workout-to-workout-template",
			);
			yield* insertRelationshipRow(client, {
				targetEntityId: legs,
				sourceEntityId: repeatedLegs,
				relationshipSchema: repeatedFrom.reference,
			});
			for (const sourceEntityId of [firstPull, secondPull]) {
				yield* insertRelationshipRow(client, {
					sourceEntityId,
					targetEntityId: workoutTemplateId,
					relationshipSchema: fromTemplate.reference,
				});
			}

			const page = yield* executeRyotQLRecipe(
				client,
				workoutCardsRecipe({ reference, search: "" }),
			);
			expect(
				page.items.map(({ id, volume, setCount, repeatedFromId, previousTemplateWorkoutId }) => ({
					id,
					volume,
					setCount,
					repeatedFromId,
					previousTemplateWorkoutId,
				})),
			).toEqual([
				{
					setCount: 2,
					volume: 1050,
					id: repeatedLegs,
					repeatedFromId: legs,
					previousTemplateWorkoutId: null,
				},
				{
					setCount: 0,
					volume: null,
					id: secondPull,
					repeatedFromId: null,
					previousTemplateWorkoutId: firstPull,
				},
				{
					id: legs,
					volume: 500,
					setCount: 1,
					repeatedFromId: null,
					previousTemplateWorkoutId: null,
				},
				{
					volume: 400,
					setCount: 1,
					id: firstPull,
					repeatedFromId: null,
					previousTemplateWorkoutId: null,
				},
			]);
			expect(page.items[0]?.sets.map(({ weight }) => weight)).toEqual([110, 100]);
			expect(page.items[1]?.template?.name).toBe("Pull B");
			expect(
				(yield* executeRyotQLRecipe(
					client,
					workoutCardsRecipe({ reference, search: "pul", workoutIds: [secondPull, legs] }),
				)).items.map(({ id }) => id),
			).toEqual([secondPull]);
			expect(
				yield* executeRyotQLRecipe(client, workoutCountRecipe({ reference, search: "pul" })),
			).toBe(2);
			expect(
				yield* executeRyotQLRecipe(
					client,
					workoutComparisonsRecipe({ reference, workoutIds: [legs] }),
				),
			).toEqual([{ id: legs, volume: 500, startedAt: expect.any(String) }]);

			const weeks = yield* executeRyotQLRecipe(
				client,
				workoutWeeksRecipe({
					reference,
					search: "",
					timeZone: "UTC",
					endAt: "2026-10-19T00:00:00Z",
					startAt: "2026-09-28T00:00:00Z",
				}),
			);
			expect(weeks.map(({ volume, workouts }) => ({ volume, workouts }))).toEqual([
				{ workouts: 1, volume: 400 },
				{ workouts: 2, volume: 500 },
				{ workouts: 1, volume: 1050 },
			]);

			const summary = yield* executeRyotQLRecipe(
				client,
				workoutSummaryRecipe({
					reference,
					timeZone: "UTC",
					days: { endAt: "2026-10-19T00:00:00Z", startAt: "2026-09-28T00:00:00Z" },
					current: { endAt: "2026-10-16T00:00:00Z", startAt: "2026-10-09T00:00:00Z" },
					previous: { endAt: "2026-10-09T00:00:00Z", startAt: "2026-10-02T00:00:00Z" },
				}),
			);
			expect(summary.current).toMatchObject({ workouts: 1, volume: 1050 });
			expect(summary.previous).toMatchObject({ workouts: 2, volume: 500 });
			expect(summary.days.map(({ workouts }) => workouts)).toEqual([1, 1, 1, 1]);
		}),
	);

	it.live("creates a workout entity and retrieves it by id", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { workoutId } = yield* createWorkoutEntityFixture(client);
			const entity = yield* getEntity(client, workoutId);

			expect(entity.id).toBe(workoutId);
			expect(entity.properties).toMatchObject({
				endedAt: "2026-04-27T11:00:00Z",
				startedAt: "2026-04-27T10:00:00Z",
			});
		}),
	);

	it.live("shows workout entities through the All Workouts saved-view defaults", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findFitnessEntitySchema(client, "workout");
			yield* createWorkoutEntityFixture(client);

			const result = yield* executeRyotQLRecipe(
				client,
				workoutListRecipe({ reference: { pluginId, kind: "local" } }),
			);

			const firstWorkout = result.items[0];
			assertPresent(firstWorkout, "Expected at least one workout item");
			expect(result.items.length).toBeGreaterThan(0);
			expect(firstWorkout.startedAt).toEqual(expect.any(String));
		}),
	);

	it.live("logs a workout set linked to a workout via sessionEntityId", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { workoutId } = yield* createWorkoutEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
			const { exerciseId } = yield* createExerciseEntityFixture(client);

			const createResult = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: exerciseId,
							sessionEntityId: workoutId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: { reps: 10, weight: 60, setOrder: 0, setLot: "normal", exerciseOrder: 0 },
						},
					],
				}),
			);

			expect((yield* waitForCreateEvents(client, createResult)).count).toBe(1);

			const events = yield* waitForSessionEventCount(client, workoutId, 1);
			expect(events[0]?.sessionEntityId).toBe(workoutId);
			expect(events[0]?.entityId).toBe(exerciseId);
			expect(events[0]?.properties).toMatchObject({ exerciseOrder: 0 });
			expect(events[0]?.properties).not.toHaveProperty("images");
			expect(events[0]?.properties).not.toHaveProperty("videos");
		}),
	);

	it.live("listing events by sessionEntityId returns only sets for that workout", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { workoutId: workoutOneId } = yield* createWorkoutEntityFixture(client);
			const { workoutId: workoutTwoId } = yield* createWorkoutEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
			const { exerciseId } = yield* createExerciseEntityFixture(client);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: exerciseId,
							sessionEntityId: workoutOneId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: { reps: 10, setOrder: 0, setLot: "normal", exerciseOrder: 0 },
						},
						{
							entityId: exerciseId,
							sessionEntityId: workoutOneId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: { reps: 8, setOrder: 1, setLot: "normal", exerciseOrder: 0 },
						},
						{
							entityId: exerciseId,
							sessionEntityId: workoutTwoId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: { reps: 6, setOrder: 0, setLot: "normal", exerciseOrder: 0 },
						},
					],
				}),
			);

			const workoutOneEvents = yield* waitForSessionEventCount(client, workoutOneId, 2);
			expect(workoutOneEvents).toHaveLength(2);
			expect(workoutOneEvents.every((event) => event.sessionEntityId === workoutOneId)).toBe(true);
		}),
	);

	it.live("listing events by entityId spans multiple workouts for the same exercise", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { workoutId: workoutOneId } = yield* createWorkoutEntityFixture(client);
			const { workoutId: workoutTwoId } = yield* createWorkoutEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
			const { exerciseId } = yield* createExerciseEntityFixture(client);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: exerciseId,
							sessionEntityId: workoutOneId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: { reps: 10, setOrder: 0, setLot: "normal", exerciseOrder: 0 },
						},
						{
							entityId: exerciseId,
							sessionEntityId: workoutTwoId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: { reps: 8, setOrder: 0, setLot: "normal", exerciseOrder: 0 },
						},
					],
				}),
			);

			const exerciseEvents = yield* waitForEventCount(client, exerciseId, 2);
			expect(exerciseEvents).toHaveLength(2);
			expect(new Set(exerciseEvents.map((event) => event.sessionEntityId))).toEqual(
				new Set([workoutOneId, workoutTwoId]),
			);
		}),
	);

	it.live("creates a workout-repeated-from relationship between two workouts", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { workoutId: originalWorkoutId } = yield* createWorkoutEntityFixture(client);
			const { workoutId: copiedWorkoutId } = yield* createWorkoutEntityFixture(client);

			const relationshipSchema = yield* findFitnessRelationshipSchema(
				client,
				"workout-repeated-from",
			);

			const relationship = yield* insertRelationshipRow(client, {
				sourceEntityId: copiedWorkoutId,
				targetEntityId: originalWorkoutId,
				relationshipSchema: relationshipSchema.reference,
			});

			expect(relationship.wasInserted).toBe(true);
			expect(relationship.sourceEntityId).toBe(copiedWorkoutId);
			expect(relationship.targetEntityId).toBe(originalWorkoutId);
			expect(relationship.relationshipSchemaSlug).toBe(relationshipSchema.id);
		}),
	);
});
