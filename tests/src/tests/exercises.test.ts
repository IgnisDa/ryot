import { describe, expect, it } from "bun:test";

import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createTransformExpression,
} from "@ryot/app-backend/query-language";

import type { Client } from "../fixtures";
import {
	buildGridRequest,
	createEntity,
	createAuthenticatedClient,
	createWorkoutEntityFixture,
	entityField,
	executeQueryEngine,
	findBuiltinTrackerBySlug,
	findBuiltinSchemaBySlug,
	findWorkoutSetEventSchema,
	getQueryEngineFieldOrThrow,
	listEntitySchemas,
	listSavedViews,
	literalExpression,
	mergeUserState,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";
import { getPgClient } from "../setup";
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
				buildGridRequest({
					scope: ["exercise"],
					pagination: { page: 1, limit: 1 },
					displayConfiguration: {
						titleProperty: [entityField("exercise", "name")],
						imageProperty: [entityField("exercise", "image")],
						calloutProperty: [entityField("exercise", "level")],
						primarySubtitleProperty: [entityField("exercise", "kind")],
						secondarySubtitleProperty: [entityField("exercise", "equipment")],
					},
					filter: {
						operator: "eq",
						type: "comparison",
						right: literalExpression(seededExerciseName),
						left: createEntityColumnExpression("exercise", "name"),
					},
				}),
			);

			return data.data.items[0] ?? null;
		},
		{ intervalMs: 1000, timeoutMs: 60000 },
	);
};

async function insertWorkoutSetEvent(input: {
	userId: string;
	entityId: string;
	sessionEntityId: string;
	eventSchemaId: string;
}) {
	const pg = getPgClient();

	await pg.query(
		`insert into event (
			id,
			user_id,
			entity_id,
			event_schema_id,
			session_entity_id,
			occurred_at,
			properties
		) values ($1, $2, $3, $4, $5, now(), $6::jsonb)`,
		[
			crypto.randomUUID(),
			input.userId,
			input.entityId,
			input.eventSchemaId,
			input.sessionEntityId,
			JSON.stringify({ setOrder: 0, exerciseOrder: 0 }),
		],
	);
}

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
			queryDefinition: {
				filter: null,
				eventJoins: [],
				computedFields: [],
				scope: ["exercise"],
				relationshipJoins: [],
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression("exercise", "name"),
				},
			},
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
		const { client, userId } = await createAuthenticatedClient();
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

		await insertWorkoutSetEvent({
			userId,
			entityId: source.id,
			sessionEntityId: workoutId,
			eventSchemaId: workoutSetEventSchema.id,
		});

		const result = await mergeUserState(client, { mergeFrom: source.id, mergeInto: target.id });
		const sourceEvents = await client.run((c) =>
			c.events.list({ urlParams: { entityId: source.id } }),
		);
		const targetEvents = await client.run((c) =>
			c.events.list({ urlParams: { entityId: target.id } }),
		);

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
