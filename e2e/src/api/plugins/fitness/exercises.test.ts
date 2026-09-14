import { exerciseListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	type Client,
	createEntity,
	createAuthenticatedClient,
	executeRyotQL,
	executeRyotQLRecipe,
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
			const schemas = yield* listEntitySchemas(client, { pluginSlug: fitnessPlugin.slug });
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
			const views = yield* listSavedViews(client, { pluginSlug: fitnessPlugin.slug });
			const allExercisesView = views.find((view) => view.name === "All Exercises");
			assertPresent(allExercisesView, "Expected the built-in All Exercises saved view");
			const dataSources = requirePresent(
				allExercisesView.dataSources,
				"All Exercises saved view has no data sources",
			);
			const savedViewSource = dataSources.queries.savedView;
			assertPresent(savedViewSource, "Expected the All Exercises named source");
			assertCondition(
				savedViewSource.output.type === "rows",
				"Expected the All Exercises named source to use rows output",
			);

			expect(allExercisesView).toMatchObject({
				isBuiltin: true,
				name: "All Exercises",
				pluginSlug: fitnessPlugin.slug,
				renderer: { kind: "kernel", name: "entity-browser" },
				settings: {
					pageSize: 20,
					defaultLayout: "grid",
					sourceName: "savedView",
					entityIdField: "entityId",
					searchFields: ["column0"],
					layouts: ["grid", "list", "table"],
					ownerPluginIdField: "ownerPluginId",
					entitySchemaSlugField: "entitySchemaSlug",
					addAction: {
						type: "provider-search",
						entitySchemaSlug: "exercise",
						ownerPluginId: expect.any(String),
					},
					tableColumns: [
						{ label: "Name", field: "column0" },
						{ label: "Level", field: "column1" },
						{ field: "column2", label: "Equipment" },
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
						right: { type: "literal", value: "exercise" },
						left: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
					}),
				]),
			});
			expect(
				savedViewSource.output.fields.map((selection) => "key" in selection && selection.key),
			).toEqual([
				"entityId",
				"image",
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
			const dataSources = requirePresent(
				savedView.dataSources,
				"All Exercises saved view has no data sources",
			);
			const sourceName = savedView.settings["sourceName"];
			assertCondition(typeof sourceName === "string", "Expected a named saved-view source");
			const savedViewResult = requireRows(
				(yield* executeRyotQL(client, dataSources)).data[sourceName],
				sourceName,
			);
			const savedViewExercise = savedViewResult.items.find(
				(item) => requireRyotQLValue(item, "column0") === seededExerciseName,
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
			expect(error.reason).toEqual({ property: "kind", code: "identity-property-mismatch" });
		}),
	);
});
