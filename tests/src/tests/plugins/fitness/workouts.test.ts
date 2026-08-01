import type { FieldSelection } from "@ryot/contract/modules/ryotql/language";
import { buildWorkoutListQueryDocument } from "@ryot/fitness-plugin/query-recipes";
import { column, field, jsonPath, literal, table } from "@ryot/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createWorkoutEntityFixture,
	executeRyotQL,
	findBuiltinRelationshipSchemaSlug,
	findBuiltinSchemaBySlug,
	findBuiltinPluginBySlug,
	findWorkoutSetEventSchema,
	getEntity,
	insertRelationshipRow,
	listEntitySchemas,
	listSavedViews,
	waitForEventCount,
	waitForSeededExerciseId,
	waitForSessionEventCount,
	requireRyotQLFieldValue,
	requireRows,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const savedViewEntity = table("entity", "entity");
const expectedSavedViewFields = [
	field("entityId", column(savedViewEntity, "id")),
	field("gridTitle", column(savedViewEntity, "name")),
	field("gridEyebrow", literal("Workout")),
	field("gridPrimarySubtitle", jsonPath(column(savedViewEntity, "properties"), "startedAt")),
	field("gridSecondarySubtitle", jsonPath(column(savedViewEntity, "properties"), "endedAt")),
	field("listTitle", column(savedViewEntity, "name")),
	field("listEyebrow", literal("Workout")),
	field("listPrimarySubtitle", jsonPath(column(savedViewEntity, "properties"), "startedAt")),
	field("listSecondarySubtitle", jsonPath(column(savedViewEntity, "properties"), "endedAt")),
	field("tableColumn0", column(savedViewEntity, "name")),
	field("tableColumn1", jsonPath(column(savedViewEntity, "properties"), "startedAt")),
	field("tableColumn2", jsonPath(column(savedViewEntity, "properties"), "endedAt")),
] satisfies readonly FieldSelection[];

describe("Workouts E2E", () => {
	it.live("links the built-in workout schema to the fitness plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
			const schemas = yield* listEntitySchemas(client, {
				pluginSlug: fitnessPlugin.slug,
			});
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
				comment: {
					type: "string",
					label: "Comment",
					description: "Optional notes or comments about this workout",
				},
				images: {
					type: "array",
					label: "Images",
					description: "Images attached to this workout",
				},
				videos: {
					type: "array",
					label: "Videos",
					description: "Videos attached to this workout",
				},
				endedAt: {
					type: "datetime",
					label: "Ended At",
					description: "Date and time this workout session ended",
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
			const views = yield* listSavedViews(client, {
				pluginSlug: fitnessPlugin.slug,
			});
			const allWorkoutsView = views.find((view) => view.name === "All Workouts");
			assertPresent(allWorkoutsView, "Expected the built-in All Workouts saved view");
			const savedViewQuery = allWorkoutsView.queryDocument.queries.savedView;
			assertPresent(savedViewQuery, "Expected the All Workouts saved-view query");
			if (savedViewQuery.output.type !== "rows") {
				throw new Error("Expected the All Workouts saved-view query to use rows output");
			}

			expect(allWorkoutsView).toMatchObject({
				isBuiltin: true,
				name: "All Workouts",
				pluginSlug: fitnessPlugin.slug,
				queryDocument: {
					queries: {
						savedView: {
							where: {
								left: { field: "entitySchemaSlug", tableAlias: "entity" },
								right: { value: "workout" },
							},
						},
					},
				},
				displayConfiguration: {
					grid: {
						imageField: null,
						calloutField: null,
						titleField: "gridTitle",
						eyebrowField: "gridEyebrow",
						secondarySubtitleField: "gridSecondarySubtitle",
						primarySubtitleField: "gridPrimarySubtitle",
					},
					list: {
						imageField: null,
						calloutField: null,
						titleField: "listTitle",
						eyebrowField: "listEyebrow",
						secondarySubtitleField: "listSecondarySubtitle",
						primarySubtitleField: "listPrimarySubtitle",
					},
					entityIdField: "entityId",
					table: {
						columns: [
							{ label: "Name", field: "tableColumn0" },
							{ label: "Started At", field: "tableColumn1" },
							{ label: "Ended At", field: "tableColumn2" },
						],
					},
				},
			});
			expect(savedViewQuery.output.fields).toEqual(expectedSavedViewFields);
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

			const result = yield* executeRyotQL(client, buildWorkoutListQueryDocument({}));
			const workouts = requireRows(result.data["workouts"], "workouts");

			const firstWorkout = workouts.items[0];
			assertPresent(firstWorkout, "Expected at least one workout item");
			expect(workouts.items.length).toBeGreaterThan(0);
			expect(requireRyotQLFieldValue(firstWorkout, "startedAt")).toMatchObject({
				kind: "date",
			});
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
							properties: {
								reps: 10,
								setOrder: 0,
								setLot: "normal",
								exerciseOrder: 0,
							},
						},
						{
							entityId: exerciseId,
							sessionEntityId: workoutOneId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: {
								reps: 8,
								setOrder: 1,
								setLot: "normal",
								exerciseOrder: 0,
							},
						},
						{
							entityId: exerciseId,
							sessionEntityId: workoutTwoId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: {
								reps: 6,
								setOrder: 0,
								setLot: "normal",
								exerciseOrder: 0,
							},
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
							properties: {
								reps: 10,
								setOrder: 0,
								setLot: "normal",
								exerciseOrder: 0,
							},
						},
						{
							entityId: exerciseId,
							sessionEntityId: workoutTwoId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: {
								reps: 8,
								setOrder: 0,
								setLot: "normal",
								exerciseOrder: 0,
							},
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
