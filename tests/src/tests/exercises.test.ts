import { describe, expect, it } from "bun:test";

import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createTransformExpression,
} from "@ryot/app-backend/query-language";

import type { Client } from "../fixtures";
import {
	buildEntityRowsQueryDocument,
	createEntity,
	createAuthenticatedClient,
	createWorkoutEntityFixture,
	executeQueryEngine,
	findBuiltinTrackerBySlug,
	findBuiltinSchemaBySlug,
	findWorkoutSetEventSchema,
	getQueryEngineFieldOrThrow,
	listEntitySchemas,
	listEventsForEntity,
	listSavedViews,
	literalExpr,
	mergeUserState,
	propertyRef,
	systemRef,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";
import { assertTaggedError } from "../test-support/assertions";

const seededExerciseName = "3/4 Sit-Up";
const seededExerciseImageUrl =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/3_4_Sit-Up/0.jpg";

const waitForSeededExercise = async (client: Client) => {
	return pollUntil(
		`exercise '${seededExerciseName}' to be queryable`,
		async () => {
			const { data } = await executeQueryEngine(
				client,
				buildEntityRowsQueryDocument({
					limit: 1,
					alias: "exercise",
					schemas: ["exercise"],
					fields: [
						{ key: "title", expr: systemRef("exercise", "name") },
						{ key: "image", expr: systemRef("exercise", "image") },
						{ key: "callout", expr: propertyRef("exercise", "exercise", "level") },
						{ key: "primarySubtitle", expr: propertyRef("exercise", "exercise", "kind") },
						{ key: "secondarySubtitle", expr: propertyRef("exercise", "exercise", "equipment") },
					],
					where: {
						type: "comparison",
						operator: "eq",
						left: systemRef("exercise", "name"),
						right: literalExpr(seededExerciseName),
					},
				}),
			);

			return data.items[0] ?? null;
		},
		{ intervalMs: 1000, timeoutMs: 60000 },
	);
};

describe("Exercises E2E", () => {
	it("links the built-in exercise schema to the fitness tracker", async () => {
		const { client } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(client, "fitness");
		const schemas = await listEntitySchemas(client, {
			trackerId: fitnessTracker.id,
		});
		const exerciseSchema = schemas.find((schema) => schema.slug === "exercise");

		expect(exerciseSchema).toBeDefined();
		expect(exerciseSchema?.name).toBe("Exercise");
		expect(exerciseSchema?.slug).toBe("exercise");
		expect(exerciseSchema?.icon).toBe("zap");
		expect(exerciseSchema?.isBuiltin).toBe(true);
		expect(exerciseSchema?.trackerId).toBe(fitnessTracker.id);
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
	});

	it("creates the built-in All Exercises saved view with exercise defaults", async () => {
		const { client } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(client, "fitness");
		const views = await listSavedViews(client, {
			trackerId: fitnessTracker.id,
		});
		const allExercisesView = views.find((view) => view.name === "All Exercises");

		expect(allExercisesView).toBeDefined();
		expect(allExercisesView).toMatchObject({
			isBuiltin: true,
			name: "All Exercises",
			trackerId: fitnessTracker.id,
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
					imageProperty: createEntityColumnExpression("exercise", "image"),
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
					imageProperty: createEntityColumnExpression("exercise", "image"),
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
	});

	it("lists seeded built-in exercises through the query engine", async () => {
		const { client } = await createAuthenticatedClient();
		const exercise = await waitForSeededExercise(client);

		expect(getQueryEngineFieldOrThrow(exercise, "title")).toEqual({
			key: "title",
			kind: "text",
			value: seededExerciseName,
		});
		expect(getQueryEngineFieldOrThrow(exercise, "image")).toEqual({
			key: "image",
			kind: "image",
			value: { type: "remote", url: seededExerciseImageUrl },
		});
		expect(getQueryEngineFieldOrThrow(exercise, "callout")).toEqual({
			kind: "text",
			key: "callout",
			value: "beginner",
		});
		expect(getQueryEngineFieldOrThrow(exercise, "primarySubtitle")).toEqual({
			kind: "text",
			key: "primarySubtitle",
			value: "reps_and_weight",
		});
		expect(getQueryEngineFieldOrThrow(exercise, "secondarySubtitle")).toEqual({
			kind: "text",
			value: "body_only",
			key: "secondarySubtitle",
		});
	});

	it("merges workout-set events between exercises with the same kind", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema: exerciseSchema } = await findBuiltinSchemaBySlug(client, "exercise");
		const { workoutId } = await createWorkoutEntityFixture(client);
		const { workoutSetEventSchema } = await findWorkoutSetEventSchema(client);
		const source = await createEntity(client, {
			image: null,
			name: "Source Exercise",
			entitySchemaId: exerciseSchema.id,
			properties: { kind: "reps", muscles: ["abdominals"] },
		});
		const target = await createEntity(client, {
			image: null,
			name: "Target Exercise",
			entitySchemaId: exerciseSchema.id,
			properties: { kind: "reps", muscles: ["abdominals"] },
		});

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId: source.id,
						sessionEntityId: workoutId,
						eventSchemaId: workoutSetEventSchema.id,
						properties: { setOrder: 0, exerciseOrder: 0 },
					},
				],
			}),
		);
		await pollUntil("source workout set event", async () => {
			const events = await listEventsForEntity(client, source.id);
			return events.length === 1 ? events : null;
		});

		const result = await mergeUserState(client, { mergeFrom: source.id, mergeInto: target.id });
		const sourceEvents = await listEventsForEntity(client, source.id);
		const targetEvents = await listEventsForEntity(client, target.id);

		expect(result.movedEventsCount).toBe(1);
		expect(sourceEvents).toHaveLength(0);
		expect(targetEvents).toHaveLength(1);
		expect(targetEvents[0]?.sessionEntityId).toBe(workoutId);
	});

	it("rejects merging exercises with different kinds", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema: exerciseSchema } = await findBuiltinSchemaBySlug(client, "exercise");
		const source = await createEntity(client, {
			image: null,
			name: "Source Reps Exercise",
			entitySchemaId: exerciseSchema.id,
			properties: { kind: "reps", muscles: ["abdominals"] },
		});
		const target = await createEntity(client, {
			image: null,
			name: "Target Duration Exercise",
			entitySchemaId: exerciseSchema.id,
			properties: { kind: "duration", muscles: ["abdominals"] },
		});

		const error = await client.runError((c) =>
			c.userState.mergeUserState({ payload: { mergeFrom: source.id, mergeInto: target.id } }),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe("Exercises must have the same kind");
	});
});
