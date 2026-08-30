import { workoutListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	findBuiltinPluginBySlug,
	getEntity,
	insertRelationshipRow,
	listEntitySchemas,
	listSavedViews,
	waitForEventCount,
} from "~/fixtures/kernel";
import {
	createWorkoutEntityFixture,
	findBuiltinRelationshipSchemaSlug,
	findWorkoutSetEventSchema,
	waitForSeededExerciseId,
	waitForSessionEventCount,
} from "~/fixtures/plugins/fitness";
import { assertCondition, assertPresent, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Workouts E2E", () => {
	it.live("links the built-in workout schema to the fitness plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
			const schemas = yield* listEntitySchemas(client, { pluginSlug: fitnessPlugin.slug });
			const workoutSchema = schemas.find((schema) => schema.slug === "workout");

			expect(workoutSchema).toBeDefined();
			expect(workoutSchema?.name).toBe("Workout");
			expect(workoutSchema?.pluginSlug).toBe(fitnessPlugin.slug);
			expect(workoutSchema?.isBuiltin).toBe(true);
		}),
	);

	it.live("exposes the workout schema properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutSchema } = yield* findBuiltinSchemaBySlug(client, "workout");

			expect(workoutSchema.propertiesSchema.fields).toMatchObject({
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
					description: "Estimated calories burned during this workout",
				},
			});
		}),
	);

	it.live("persists normalized workout media", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: workoutSchema } = yield* findBuiltinSchemaBySlug(client, "workout");
			const workout = yield* createEntity(client, {
				entitySchemaSlug: workoutSchema.id,
				name: `Workout ${crypto.randomUUID()}`,
				properties: {
					endedAt: "2026-04-27T11:00:00Z",
					startedAt: "2026-04-27T10:00:00Z",
					videos: [{ type: "s3", key: "workouts/video.mp4" }],
					images: [{ type: "local", key: "permanent/workout.jpg" }],
				},
			});
			const entity = yield* getEntity(client, workout.id);

			expect(entity.properties).toMatchObject({
				videos: [{ type: "s3", key: "workouts/video.mp4" }],
				images: [{ type: "local", key: "permanent/workout.jpg" }],
			});
		}),
	);

	it.live("creates the built-in All Workouts saved view with workout defaults", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
			const views = yield* listSavedViews(client, { pluginSlug: fitnessPlugin.slug });
			const allWorkoutsView = views.find((view) => view.name === "All Workouts");
			assertPresent(allWorkoutsView, "Expected the built-in All Workouts saved view");
			const dataSources = requirePresent(
				allWorkoutsView.dataSources,
				"All Workouts saved view has no data sources",
			);
			const savedViewSource = dataSources.queries.savedView;
			assertPresent(savedViewSource, "Expected the All Workouts named source");
			assertCondition(
				savedViewSource.output.type === "rows",
				"Expected the All Workouts named source to use rows output",
			);

			expect(allWorkoutsView).toMatchObject({
				isBuiltin: true,
				name: "All Workouts",
				pluginSlug: fitnessPlugin.slug,
				renderer: { kind: "kernel", name: "entity-browser" },
				settings: {
					defaultLayout: "grid",
					sourceName: "savedView",
					entityIdField: "entityId",
					searchFields: ["column0"],
					layouts: ["grid", "list", "table"],
					ownerPluginIdField: "ownerPluginId",
					entitySchemaSlugField: "entitySchemaSlug",
					addAction: {
						type: "provider-search",
						entitySchemaSlug: "workout",
						ownerPluginId: expect.any(String),
					},
					tableColumns: [
						{ label: "Name", field: "column0", displayKind: "text" },
						{ field: "column1", label: "Started At", displayKind: "date" },
						{ field: "column2", label: "Ended At", displayKind: "date" },
					],
				},
			});
			expect(savedViewSource.output.fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						key: "entityId",
						expr: { field: "id", type: "column", tableAlias: "entity" },
					}),
					expect.objectContaining({
						key: "ownerPluginId",
						expr: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
					}),
					expect.objectContaining({
						key: "entitySchemaSlug",
						expr: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
					}),
				]),
			);
			expect(savedViewSource.where).toMatchObject({
				type: "and",
				predicates: expect.arrayContaining([
					expect.objectContaining({
						right: { type: "literal", value: "workout" },
						left: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
					}),
				]),
			});
			expect(
				savedViewSource.output.fields.map((selection) => "key" in selection && selection.key),
			).toEqual([
				"entityId",
				"column0",
				"column1",
				"column2",
				"populationStatus",
				"translationStatus",
				"ownerPluginId",
				"entitySchemaSlug",
			]);
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
			yield* createWorkoutEntityFixture(client);

			const result = yield* executeRyotQLRecipe(client, workoutListRecipe({}));

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
			const exerciseId = yield* waitForSeededExerciseId(client);

			const createResult = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: exerciseId,
							sessionEntityId: workoutId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: {
								reps: 10,
								weight: 60,
								setOrder: 0,
								setLot: "normal",
								exerciseOrder: 0,
								images: [
									{ type: "remote", url: "https://example.com/workout-image.jpg" },
									{ type: "s3", key: "workouts/image.jpg" },
								],
								videos: [
									{ type: "remote", url: "https://example.com/workout-video.mp4" },
									{ type: "s3", key: "workouts/video.mp4" },
								],
							},
						},
					],
				}),
			);

			expect(createResult.count).toBe(1);

			const events = yield* waitForSessionEventCount(client, workoutId, 1);
			expect(events[0]?.sessionEntityId).toBe(workoutId);
			expect(events[0]?.entityId).toBe(exerciseId);
			expect(events[0]?.properties).toMatchObject({
				images: [
					{ type: "remote", url: "https://example.com/workout-image.jpg" },
					{ type: "s3", key: "workouts/image.jpg" },
				],
				videos: [
					{ type: "remote", url: "https://example.com/workout-video.mp4" },
					{ type: "s3", key: "workouts/video.mp4" },
				],
			});
		}),
	);

	it.live("listing events by sessionEntityId returns only sets for that workout", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { workoutId: workoutOneId } = yield* createWorkoutEntityFixture(client);
			const { workoutId: workoutTwoId } = yield* createWorkoutEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
			const exerciseId = yield* waitForSeededExerciseId(client);

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
			const exerciseId = yield* waitForSeededExerciseId(client);

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

			const relationshipSchemaSlug = yield* findBuiltinRelationshipSchemaSlug(
				client,
				"workout-repeated-from",
			);

			const relationship = yield* insertRelationshipRow(client, {
				relationshipSchemaSlug,
				sourceEntityId: copiedWorkoutId,
				targetEntityId: originalWorkoutId,
			});

			expect(relationship.wasInserted).toBe(true);
			expect(relationship.sourceEntityId).toBe(copiedWorkoutId);
			expect(relationship.targetEntityId).toBe(originalWorkoutId);
			expect(relationship.relationshipSchemaSlug).toBe(relationshipSchemaSlug);
		}),
	);
});
