import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createEntityPropertyPathExpression,
	createTransformExpression,
} from "@ryot/contract/display-configuration";
import { buildExerciseListQueryDocument } from "@ryot/query-engine/recipes/fitness";
import { Effect } from "effect";

import {
	type Client,
	createEntity,
	createAuthenticatedClient,
	createWorkoutEntityFixture,
	executeQueryEngine,
	adminHeaders,
	findBuiltinWorkspaceBySlug,
	findBuiltinSchemaBySlug,
	findWorkoutSetEventSchema,
	getQueryEngineFieldOrThrow,
	getBackendClient,
	listEntitySchemas,
	listEventsForEntity,
	listSavedViews,
	mergeUserState,
	pollUntil,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const seededExerciseName = "3/4 Sit-Up";
const seededExerciseImageUrl =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/3_4_Sit-Up/0.jpg";

const waitForSeededExercise = (client: Client) =>
	pollUntil(
		`exercise '${seededExerciseName}' to be queryable`,
		Effect.gen(function* () {
			const { data } = yield* executeQueryEngine(
				client,
				buildExerciseListQueryDocument({
					limit: 1,
					name: seededExerciseName,
				}),
			);

			return data.items[0] ?? null;
		}),
		{ intervalMs: 1000, timeoutMs: 60000 },
	);

describe("Exercises E2E", () => {
	it.live("links the built-in exercise schema to the fitness plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessWorkspace = yield* findBuiltinWorkspaceBySlug(client, "fitness");
			const schemas = yield* listEntitySchemas(client, {
				pluginSlug: fitnessWorkspace.slug,
			});
			const exerciseSchema = schemas.find((schema) => schema.slug === "exercise");

			expect(exerciseSchema).toBeDefined();
			expect(exerciseSchema?.name).toBe("Exercise");
			expect(exerciseSchema?.slug).toBe("exercise");
			expect(exerciseSchema?.icon).toBe("zap");
			expect(exerciseSchema?.isBuiltin).toBe(true);
			expect(exerciseSchema?.pluginSlug).toBe(fitnessWorkspace.slug);
			expect(exerciseSchema?.accentColor).toBe("#14B8A6");
			expect(exerciseSchema?.providers).toHaveLength(1);
			expect(exerciseSchema?.providers[0]).toMatchObject({
				name: "Free Exercise DB",
				scriptId: expect.any(String),
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
			expect(exerciseSchema?.propertiesSchema.fields).not.toHaveProperty("source");
		}),
	);

	it.live("creates the built-in All Exercises saved view with exercise defaults", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessWorkspace = yield* findBuiltinWorkspaceBySlug(client, "fitness");
			const views = yield* listSavedViews(client, {
				pluginSlug: fitnessWorkspace.slug,
			});
			const allExercisesView = views.find((view) => view.name === "All Exercises");

			expect(allExercisesView).toBeDefined();
			expect(allExercisesView).toMatchObject({
				isBuiltin: true,
				name: "All Exercises",
				pluginSlug: fitnessWorkspace.slug,
				queryDocument: { source: { schemas: ["exercise"] } },
				displayConfiguration: {
					table: {
						columns: [
							{
								label: "Name",
								expression: createEntityColumnExpression("exercise", "name"),
							},
							{
								label: "Level",
								expression: createTransformExpression(
									"titleCase",
									createEntityPropertyExpression("exercise", "level"),
								),
							},
							{
								label: "Equipment",
								expression: createTransformExpression(
									"titleCase",
									createEntityPropertyExpression("exercise", "equipment"),
								),
							},
						],
					},
					grid: {
						titleProperty: createEntityColumnExpression("exercise", "name"),
						imageProperty: createEntityPropertyPathExpression("exercise", ["images", "0"]),
						calloutProperty: createTransformExpression(
							"titleCase",
							createEntityPropertyExpression("exercise", "level"),
						),
						primarySubtitleProperty: createTransformExpression(
							"titleCase",
							createEntityPropertyExpression("exercise", "kind"),
						),
						secondarySubtitleProperty: createTransformExpression(
							"titleCase",
							createEntityPropertyExpression("exercise", "equipment"),
						),
					},
					list: {
						titleProperty: createEntityColumnExpression("exercise", "name"),
						imageProperty: createEntityPropertyPathExpression("exercise", ["images", "0"]),
						calloutProperty: createTransformExpression(
							"titleCase",
							createEntityPropertyExpression("exercise", "level"),
						),
						primarySubtitleProperty: createTransformExpression(
							"titleCase",
							createEntityPropertyExpression("exercise", "kind"),
						),
						secondarySubtitleProperty: createTransformExpression(
							"titleCase",
							createEntityPropertyExpression("exercise", "equipment"),
						),
					},
				},
			});
		}),
	);

	it.live("lists seeded built-in exercises through the query engine", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* getBackendClient().call((c) => c.testSupport.triggerInfrequentCron(), adminHeaders);
			const exercise = yield* waitForSeededExercise(client);

			expect(getQueryEngineFieldOrThrow(exercise, "name")).toEqual({
				key: "name",
				kind: "text",
				value: seededExerciseName,
			});
			expect(getQueryEngineFieldOrThrow(exercise, "image")).toEqual({
				key: "image",
				kind: "json",
				value: { type: "remote", url: seededExerciseImageUrl },
			});
			expect(getQueryEngineFieldOrThrow(exercise, "level")).toEqual({
				kind: "text",
				key: "level",
				value: "beginner",
			});
			expect(getQueryEngineFieldOrThrow(exercise, "kind")).toEqual({
				kind: "text",
				key: "kind",
				value: "reps_and_weight",
			});
			expect(getQueryEngineFieldOrThrow(exercise, "equipment")).toEqual({
				kind: "text",
				value: "body_only",
				key: "equipment",
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
					const events = yield* listEventsForEntity(client, source.id);
					return events.length === 1 ? events : null;
				}),
			);

			const result = yield* mergeUserState(client, { mergeFrom: source.id, mergeInto: target.id });
			const sourceEvents = yield* listEventsForEntity(client, source.id);
			const targetEvents = yield* listEventsForEntity(client, target.id);

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
			expect(error.message).toBe("Exercises must have the same kind");
		}),
	);
});
