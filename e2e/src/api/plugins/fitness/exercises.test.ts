import { exerciseListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	type Client,
	createEntity,
	createAuthenticatedClient,
	executeRyotQLRecipe,
	executeRyotQL,
	findBuiltinPluginBySlug,
	findBuiltinSchemaBySlug,
	getSavedView,
	listEntitySchemas,
	listEventsForEntity,
	listSavedViews,
	mergeUserState,
	pollUntil,
	requireRyotQLValue,
	requireRows,
} from "~/fixtures/kernel";
import { createWorkoutEntityFixture, findWorkoutSetEventSchema } from "~/fixtures/plugins/fitness";
import {
	assertCondition,
	assertPresent,
	assertTaggedError,
	requirePresent,
} from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const seededExerciseName = "3/4 Sit-Up";
const seededExerciseImageUrl =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/3_4_Sit-Up/0.jpg";
const waitForSeededExercise = (client: Client) =>
	pollUntil(
		`exercise '${seededExerciseName}' to be queryable`,
		Effect.gen(function* () {
			const result = yield* executeRyotQLRecipe(
				client,
				exerciseListRecipe({ limit: 1, name: seededExerciseName }),
			);

			return result.items[0] ?? null;
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
				choices: {
					kind: "static",
					values: expect.arrayContaining([{ value: "abdominals" }, { value: "lower_back" }]),
				},
			});
			expect(exerciseSchema?.propertiesSchema.fields.equipment).toMatchObject({
				type: "enum",
				label: "Equipment",
				choices: {
					kind: "static",
					values: expect.arrayContaining([{ value: "body_only" }, { value: "ez_curl_bar" }]),
				},
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
			const allExercisesLayouts = requirePresent(
				allExercisesView.layouts,
				"All Exercises saved view has no layouts",
			);
			const savedViewQuery = allExercisesLayouts.grid.queryDocument.queries.savedView;
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
				"entityId",
				"title",
				"image",
				"overline",
				"callout",
				"primaryMetadata",
				"secondaryMetadata",
				"populationStatus",
				"translationStatus",
			]);
			expect(allExercisesLayouts).toMatchObject({
				grid: { entityIdField: "entityId", titleField: "title", imageField: "image" },
				list: { entityIdField: "entityId", titleField: "title", imageField: "image" },
				table: {
					imageField: "image",
					entityIdField: "entityId",
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

			expect(exercise.name).toBe(seededExerciseName);
			expect(exercise.image).toEqual({ type: "remote", url: seededExerciseImageUrl });
			expect(exercise.level).toBe("beginner");
			expect(exercise.kind).toBe("reps_and_weight");
			expect(exercise.equipment).toBe("body_only");

			const savedView = yield* getSavedView(client, "all-exercises");
			const savedViewLayouts = requirePresent(
				savedView.layouts,
				"All Exercises saved view has no layouts",
			);
			const savedViewResult = requireRows(
				(yield* executeRyotQL(client, savedViewLayouts.grid.queryDocument)).data.savedView,
				"savedView",
			);
			const savedViewExercise = savedViewResult.items.find(
				(item) => requireRyotQLValue(item, "title") === seededExerciseName,
			);
			assertPresent(savedViewExercise, "Expected the seeded exercise in the built-in saved view");
			expect(requireRyotQLValue(savedViewExercise, "image")).toEqual({
				type: "remote",
				url: seededExerciseImageUrl,
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
					const events = yield* listEventsForEntity(client, source.id, undefined, 100);
					return events.length === 1 ? events : null;
				}),
			);

			const result = yield* mergeUserState(client, { mergeFrom: source.id, mergeInto: target.id });
			const sourceEvents = yield* listEventsForEntity(client, source.id, undefined, 100);
			const targetEvents = yield* listEventsForEntity(client, target.id, undefined, 100);

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

			assertTaggedError(error, "UserStateBadRequest");
			expect(error.reason).toEqual({ code: "identity-property-mismatch", property: "kind" });
		}),
	);
});
