import { builtinSavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import {
	workoutCardsRecipe,
	workoutComparisonsRecipe,
	workoutCountRecipe,
	workoutSummaryRecipe,
	workoutWeeksRecipe,
} from "@ryot-app/fitness-plugin/workout-list-recipes";
import {
	and,
	column,
	defineRecipe,
	eq,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	executeRyotQLRecipe,
	getEntity,
	insertRelationshipRow,
	listEventsForEntity,
	listSavedViews,
	pollUntil,
	uploadPermanentAsset,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	createExerciseEntityFixture,
	createWorkoutEntityFixture,
	createWorkoutTemplateEntityFixture,
	findFitnessEntitySchema,
	findFitnessRelationshipSchema,
	findWorkoutSetEventSchema,
	saveWorkoutData,
	workoutData,
	workoutOccurrence,
	type WorkoutOccurrenceInput,
	workoutReference,
	workoutSet,
	type WorkoutSetInput,
} from "~/fixtures/plugins/fitness";
import { assertCondition, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const workoutSessionSetsRecipe = defineRecipe(
	(input: {
		readonly workoutId: string;
		readonly reference: Parameters<typeof workoutCardsRecipe>[0]["reference"];
	}) => {
		const set = table("event", "workoutSessionSet");
		return {
			map: ({ sets }) => Result.succeed(sets.items),
			queries: {
				sets: selectedRows(set, {
					limit: 100,
					orderBy: [],
					where: and(
						schemaOwnerPredicate(set, "eventSchemaPluginId", input.reference),
						eq(column(set, "eventSchemaSlug"), literal("workout-set")),
						eq(column(set, "sessionEntityId"), literal(input.workoutId)),
					),
					selection: {
						entityId: selectedField(column(set, "entityId"), Schema.String),
						eventSchemaSlug: selectedField(column(set, "eventSchemaSlug"), Schema.String),
						sessionEntityId: selectedField(column(set, "sessionEntityId"), Schema.String),
						properties: selectedField(
							column(set, "properties"),
							Schema.Record(Schema.String, Schema.Unknown),
						),
					},
				}),
			},
		};
	},
);

const saveWorkoutMeasurements = (
	client: Client,
	exerciseId: WorkoutOccurrenceInput["exerciseId"],
	sets: ReadonlyArray<WorkoutSetInput["measurements"]>,
) =>
	Effect.gen(function* () {
		const saved = yield* saveWorkoutData(
			client,
			workoutData({
				endedAt: "2026-04-27T11:00:00Z",
				startedAt: "2026-04-27T10:00:00Z",
				occurrences: [
					workoutOccurrence(
						exerciseId,
						sets.map((measurements) =>
							workoutSet({
								measurements,
								occurredAt: "2026-04-27T10:15:00Z",
								confirmedAt: "2026-04-27T10:15:00Z",
							}),
						),
					),
				],
			}),
		);
		assertCondition(saved.kind === "saved", "Expected the workout to save");
		return saved;
	});

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
			const { exerciseId } = yield* createExerciseEntityFixture(client, {
				kind: "reps_and_weight",
			});
			const workout = (name: string, day: string, weights: readonly number[]) =>
				Effect.gen(function* () {
					const saved = yield* saveWorkoutData(
						client,
						workoutData({
							name,
							endedAt: `${day}T11:00:00Z`,
							startedAt: `${day}T10:00:00Z`,
							occurrences:
								weights.length === 0
									? []
									: [
											workoutOccurrence(
												exerciseId,
												weights.map((weight) =>
													workoutSet({
														occurredAt: `${day}T10:15:00Z`,
														confirmedAt: `${day}T10:15:00Z`,
														measurements: { weight, reps: 5 },
													}),
												),
											),
										],
						}),
					);
					assertCondition(saved.kind === "saved", "Expected the workout to save");
					return saved.entityId;
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

			const readReadyCards = Effect.gen(function* () {
				const cards = yield* executeRyotQLRecipe(
					client,
					workoutCardsRecipe({ reference, search: "" }),
				);
				assertCondition(
					cards.items.every(({ failedSets }) => (failedSets ?? 0) === 0),
					"Workout record processing failed",
				);
				return cards.items.length === 4 &&
					cards.items.every(({ pendingSets }) => (pendingSets ?? 0) === 0)
					? cards
					: null;
			});
			const page = yield* pollUntil("ready workout card projections", readReadyCards);
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

	it.live("logs a workout set linked to a workout via sessionEntityId", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const created = yield* saveWorkoutMeasurements(client, exerciseId, [
				{ reps: 10, weight: 60 },
			]);
			const workoutId = created.entityId;
			expect(created.sets).toHaveLength(1);

			const reference = yield* workoutReference(client);
			const events = yield* executeRyotQLRecipe(
				client,
				workoutSessionSetsRecipe({ reference, workoutId }),
			);
			expect(events).toHaveLength(1);
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
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const { entityId: workoutOneId } = yield* saveWorkoutMeasurements(client, exerciseId, [
				{ reps: 10 },
				{ reps: 8 },
			]);
			yield* saveWorkoutMeasurements(client, exerciseId, [{ reps: 6 }]);

			const reference = yield* workoutReference(client);
			const workoutOneEvents = yield* executeRyotQLRecipe(
				client,
				workoutSessionSetsRecipe({ reference, workoutId: workoutOneId }),
			);
			expect(workoutOneEvents).toHaveLength(2);
			expect(workoutOneEvents.every((event) => event.sessionEntityId === workoutOneId)).toBe(true);
		}),
	);

	it.live("listing events by entityId spans multiple workouts for the same exercise", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const { entityId: workoutOneId } = yield* saveWorkoutMeasurements(client, exerciseId, [
				{ reps: 10 },
			]);
			const { entityId: workoutTwoId } = yield* saveWorkoutMeasurements(client, exerciseId, [
				{ reps: 8 },
			]);

			const exerciseEvents = yield* listEventsForEntity(client, exerciseId, undefined, 100, {
				eventSchemaSlug: workoutSetEventSchema.id,
			});
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
