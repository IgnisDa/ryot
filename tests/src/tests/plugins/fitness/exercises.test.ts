import { buildExerciseListQueryDocument } from "@ryot/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	type Client,
	createEntity,
	createAuthenticatedClient,
	createWorkoutEntityFixture,
	executeRyotQL,
	findBuiltinPluginBySlug,
	findBuiltinSchemaBySlug,
	findWorkoutSetEventSchema,
	getSavedView,
	listEntitySchemas,
	listEventsForEntity,
	listSavedViews,
	mergeUserState,
	pollUntil,
	requireRyotQLFieldValue,
	requireRows,
} from "~/fixtures";
import { assertCondition, assertPresent, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const seededExerciseName = "3/4 Sit-Up";
const seededExerciseImageUrl =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/3_4_Sit-Up/0.jpg";
const waitForSeededExercise = (client: Client) =>
	pollUntil(
		`exercise '${seededExerciseName}' to be queryable`,
		Effect.gen(function* () {
			const result = yield* executeRyotQL(
				client,
				buildExerciseListQueryDocument({ limit: 1, name: seededExerciseName }),
			);

			const exercises = requireRows(result.data["exercises"], "exercises");
			return exercises.items[0] ?? null;
		}),
	);

describe("Exercises E2E", () => {
	it.live("links the built-in exercise schema to the fitness plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
			const schemas = yield* listEntitySchemas(client, {
				pluginSlug: fitnessPlugin.slug,
			});
			const exerciseSchema = schemas.find((schema) => schema.slug === "exercise");

			expect(exerciseSchema).toBeDefined();
			expect(exerciseSchema?.name).toBe("Exercise");
			expect(exerciseSchema?.slug).toBe("exercise");
			expect(exerciseSchema?.icon).toBe("zap");
			expect(exerciseSchema?.isBuiltin).toBe(true);
			expect(exerciseSchema?.pluginSlug).toBe(fitnessPlugin.slug);
			expect(exerciseSchema?.providers).toHaveLength(1);
			expect(exerciseSchema?.providers[0]).toMatchObject({
				name: "Free Exercise DB",
				providerId: expect.any(String),
			});
			expect(exerciseSchema?.propertiesSchema.fields.muscles).toMatchObject({
				label: "Muscles",
				type: "enum-array",
				options: expect.arrayContaining(["abdominals", "lower_back"]),
			});
			expect(exerciseSchema?.propertiesSchema.fields.equipment).toMatchObject({
				type: "enum",
				label: "Equipment",
				options: expect.arrayContaining(["body_only", "ez_curl_bar"]),
			});
			expect(exerciseSchema?.propertiesSchema.fields.images).toMatchObject({
				type: "array",
				label: "Images",
			});
			expect(exerciseSchema?.propertiesSchema.fields.videos).toMatchObject({
				type: "array",
				label: "Videos",
			});
			expect(exerciseSchema?.propertiesSchema.fields).not.toHaveProperty("source");
		}),
	);

	it.live("creates the built-in All Exercises saved view with exercise defaults", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
			const views = yield* listSavedViews(client, {
				pluginSlug: fitnessPlugin.slug,
			});
			const allExercisesView = views.find((view) => view.name === "All Exercises");
			assertPresent(allExercisesView, "Expected the built-in All Exercises saved view");
			const savedViewQuery = allExercisesView.layouts.grid.queryDocument.queries.savedView;
			assertPresent(savedViewQuery, "Expected the All Exercises saved-view query");
			assertCondition(
				savedViewQuery.output.type === "rows",
				"Expected the All Exercises saved-view query to use rows output",
			);

			expect(allExercisesView).toMatchObject({
				isBuiltin: true,
				name: "All Exercises",
				pluginSlug: fitnessPlugin.slug,
				layouts: {
					grid: {
						queryDocument: {
							queries: {
								savedView: {
									where: {
										right: { value: "exercise" },
										left: { field: "entitySchemaSlug", tableAlias: "entity" },
									},
								},
							},
						},
					},
				},
			});
			expect(
				savedViewQuery.output.fields.map((selection) => "key" in selection && selection.key),
			).toEqual([
				"itemId",
				"title",
				"image",
				"overline",
				"callout",
				"primaryMetadata",
				"secondaryMetadata",
			]);
			expect(allExercisesView.layouts).toMatchObject({
				grid: { itemIdField: "itemId", titleField: "title", imageField: "image" },
				list: { itemIdField: "itemId", titleField: "title", imageField: "image" },
				table: {
					imageField: "image",
					itemIdField: "itemId",
					columns: [
						{ label: "Name", field: "column0" },
						{ label: "Level", field: "column1" },
						{ label: "Equipment", field: "column2" },
					],
				},
			});
		}),
	);

	it.live("lists seeded built-in exercises through RyotQL", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const exercise = yield* waitForSeededExercise(client);

			expect(requireRyotQLFieldValue(exercise, "name")).toEqual({
				kind: "text",
				value: seededExerciseName,
			});
			expect(requireRyotQLFieldValue(exercise, "image")).toEqual({
				kind: "json",
				value: { type: "remote", url: seededExerciseImageUrl },
			});
			expect(requireRyotQLFieldValue(exercise, "level")).toEqual({
				kind: "text",
				value: "beginner",
			});
			expect(requireRyotQLFieldValue(exercise, "kind")).toEqual({
				kind: "text",
				value: "reps_and_weight",
			});
			expect(requireRyotQLFieldValue(exercise, "equipment")).toEqual({
				kind: "text",
				value: "body_only",
			});

			const savedView = yield* getSavedView(client, "all-exercises");
			const savedViewResult = requireRows(
				(yield* executeRyotQL(client, savedView.layouts.grid.queryDocument)).data.savedView,
				"savedView",
			);
			const savedViewExercise = savedViewResult.items.find(
				(item) => requireRyotQLFieldValue(item, "title").value === seededExerciseName,
			);
			assertPresent(savedViewExercise, "Expected the seeded exercise in the built-in saved view");
			expect(requireRyotQLFieldValue(savedViewExercise, "image")).toEqual({
				kind: "json",
				value: { type: "remote", url: seededExerciseImageUrl },
			});
		}),
	);

	it.live("merges workout-set events between exercises with the same kind", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: exerciseSchema } = yield* findBuiltinSchemaBySlug(client, "exercise");
			const { workoutId } = yield* createWorkoutEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
			const source = yield* createEntity(client, {
				name: "Source Exercise",
				entitySchemaSlug: exerciseSchema.id,
				properties: { kind: "reps", muscles: ["abdominals"] },
			});
			const target = yield* createEntity(client, {
				name: "Target Exercise",
				entitySchemaSlug: exerciseSchema.id,
				properties: { kind: "reps", muscles: ["abdominals"] },
			});

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: source.id,
							sessionEntityId: workoutId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: { setOrder: 0, exerciseOrder: 0 },
						},
					],
				}),
			);
			yield* pollUntil(
				"source workout set event",
				Effect.gen(function* () {
					const events = yield* listEventsForEntity(client, source.id, 1, 100);
					return events.length === 1 ? events : null;
				}),
			);

			const result = yield* mergeUserState(client, { mergeFrom: source.id, mergeInto: target.id });
			const sourceEvents = yield* listEventsForEntity(client, source.id, 1, 100);
			const targetEvents = yield* listEventsForEntity(client, target.id, 1, 100);

			expect(result.movedEventsCount).toBe(1);
			expect(sourceEvents).toHaveLength(0);
			expect(targetEvents).toHaveLength(1);
			expect(targetEvents[0]?.sessionEntityId).toBe(workoutId);
		}),
	);

	it.live("rejects merging exercises with different kinds", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: exerciseSchema } = yield* findBuiltinSchemaBySlug(client, "exercise");
			const source = yield* createEntity(client, {
				name: "Source Reps Exercise",
				entitySchemaSlug: exerciseSchema.id,
				properties: { kind: "reps", muscles: ["abdominals"] },
			});
			const target = yield* createEntity(client, {
				name: "Target Duration Exercise",
				entitySchemaSlug: exerciseSchema.id,
				properties: { kind: "duration", muscles: ["abdominals"] },
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.userState.mergeUserState({ payload: { mergeFrom: source.id, mergeInto: target.id } }),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Entities must have the same 'kind' property");
		}),
	);
});
