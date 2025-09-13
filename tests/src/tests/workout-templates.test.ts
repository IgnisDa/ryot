import { describe, expect, it } from "bun:test";

import type { WorkoutTemplateProperties } from "@ryot/app-backend/lib/fitness/workout-template";
import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/ts-utils/view-language";

import {
	buildGridRequest,
	buildLatestRelationshipJoin,
	buildQueryEngineField,
	createAuthenticatedClient,
	createEntity,
	createCollection,
	createWorkoutTemplateEntityFixture,
	entityField,
	executeQueryEngine,
	findBuiltinRelationshipSchemaId,
	findBuiltinSchemaBySlug,
	findBuiltinTrackerBySlug,
	getEntity,
	getQueryEngineFieldOrThrow,
	insertRelationshipRow,
	listEntitySchemas,
	listSavedViews,
	literalExpression,
	relationshipJoinField,
	waitForSeededExerciseIds,
} from "../fixtures";

describe("Workout Templates E2E", () => {
	it("links the built-in workout-template schema to the fitness tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(client, cookies, "fitness");
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: fitnessTracker.id,
		});
		const workoutTemplateSchema = schemas.find((schema) => schema.slug === "workout-template");

		expect(workoutTemplateSchema).toBeDefined();
		expect(workoutTemplateSchema?.name).toBe("Workout Template");
		expect(workoutTemplateSchema?.trackerId).toBe(fitnessTracker.id);
		expect(workoutTemplateSchema?.isBuiltin).toBe(true);
	});

	it("exposes the workout-template schema properties", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema: workoutTemplateSchema } = await findBuiltinSchemaBySlug(
			client,
			cookies,
			"workout-template",
		);

		expect(workoutTemplateSchema.propertiesSchema.fields).toMatchObject({
			comment: {
				type: "string",
				label: "Comment",
				description: "Optional notes about this workout template",
			},
			exercises: {
				type: "array",
				label: "Exercises",
				description: "Exercises in this template",
				items: {
					type: "object",
					description: "Exercise in this template",
					properties: {
						exerciseId: {
							type: "string",
							label: "Exercise Id",
							description: "Entity id of the exercise",
						},
						exerciseOrder: {
							type: "integer",
							label: "Exercise Order",
							description: "Zero-based position of this exercise within the template",
						},
						sets: {
							label: "Sets",
							type: "array",
							description: "Sets planned for this exercise",
							items: {
								type: "object",
								description: "Set planned in this exercise",
								properties: {
									setOrder: {
										type: "integer",
										label: "Set Order",
										description: "Zero-based position of this set within the exercise",
									},
									setLot: {
										type: "enum",
										label: "Set Lot",
										options: ["normal", "warm_up", "drop", "failure"],
										description: "Set type: normal, warm_up, drop, or failure",
									},
								},
							},
						},
					},
				},
			},
			supersets: {
				type: "array",
				label: "Supersets",
				description: "Supersets in this template",
				items: {
					type: "object",
					description: "Superset in this template",
					properties: {
						color: {
							label: "Color",
							type: "string",
							description: "Display color for this superset",
						},
						exercises: {
							type: "array",
							label: "Exercises",
							description: "Zero-based exercise positions in this superset",
						},
					},
				},
			},
		});
	});

	it("creates the built-in All Workout Templates saved view with workout-template defaults", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(client, cookies, "fitness");
		const views = await listSavedViews(client, cookies, {
			trackerId: fitnessTracker.id,
		});
		const allWorkoutTemplatesView = views.find((view) => view.name === "All Workout Templates");

		expect(allWorkoutTemplatesView).toBeDefined();
		expect(allWorkoutTemplatesView).toMatchObject({
			isBuiltin: true,
			trackerId: fitnessTracker.id,
			name: "All Workout Templates",
			queryDefinition: {
				scope: ["workout-template"],
				sort: {
					direction: "desc",
					expression: createEntityColumnExpression("workout-template", "createdAt"),
				},
			},
			displayConfiguration: {
				grid: {
					calloutProperty: null,
					titleProperty: createEntityColumnExpression("workout-template", "name"),
					imageProperty: createEntityColumnExpression("workout-template", "image"),
					primarySubtitleProperty: createEntityColumnExpression("workout-template", "createdAt"),
					secondarySubtitleProperty: createEntityPropertyExpression("workout-template", "comment"),
				},
				table: {
					columns: [
						{ label: "Name", expression: createEntityColumnExpression("workout-template", "name") },
						{
							label: "Created At",
							expression: createEntityColumnExpression("workout-template", "createdAt"),
						},
						{
							label: "Comment",
							expression: createEntityPropertyExpression("workout-template", "comment"),
						},
					],
				},
			},
		});

		const { workoutTemplate } = await createWorkoutTemplateEntityFixture(client, cookies);
		const result = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: ["workout-template"],
				pagination: { page: 1, limit: 10 },
				displayConfiguration: {
					calloutProperty: null,
					titleProperty: [entityField("workout-template", "name")],
					imageProperty: [entityField("workout-template", "image")],
					primarySubtitleProperty: [entityField("workout-template", "createdAt")],
					secondarySubtitleProperty: [entityField("workout-template", "comment")],
				},
			}),
		);

		expect(result.response.status).toBe(200);
		expect(result.data.data.items.length).toBeGreaterThan(0);
		expect(getQueryEngineFieldOrThrow(result.data.data.items[0], "title").value).toBe(
			workoutTemplate.name,
		);
	});

	it("creates a workout-template entity and retrieves it by id", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { workoutTemplate, workoutTemplateId } = await createWorkoutTemplateEntityFixture(
			client,
			cookies,
		);
		const entity = await getEntity(client, cookies, workoutTemplateId);

		expect(entity.id).toBe(workoutTemplateId);
		expect(entity.name).toBe(workoutTemplate.name);
		expect(entity.properties).toMatchObject(workoutTemplate.properties);
	});

	it("persists omitted optional fields and multiple nested exercises", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema: workoutTemplateSchema } = await findBuiltinSchemaBySlug(
			client,
			cookies,
			"workout-template",
		);
		const exerciseIds = await waitForSeededExerciseIds(client, cookies, 2);
		const firstExerciseId = exerciseIds[0];
		const secondExerciseId = exerciseIds[1];
		if (!firstExerciseId || !secondExerciseId) {
			throw new Error("Missing seeded exercise ids for workout template fixture");
		}
		const workoutTemplateProperties = {
			supersets: [
				{ color: "#84CC16", exercises: [0, 1] },
				{ color: "#22C55E", exercises: [1] },
			],
			exercises: [
				{
					notes: [],
					exerciseOrder: 0,
					exerciseId: firstExerciseId,
					sets: [
						{ setOrder: 0, setLot: "normal" },
						{ setOrder: 1, note: "Ramp up", setLot: "warm_up" },
					],
				},
				{
					exerciseOrder: 1,
					exerciseId: secondExerciseId,
					notes: ["Secondary movement"],
					sets: [
						{
							rpe: 8,
							reps: 8,
							weight: 40,
							setOrder: 0,
							setLot: "drop",
							distance: null,
							duration: null,
						},
					],
				},
			],
		} satisfies WorkoutTemplateProperties;

		const workoutTemplate = await createEntity(client, cookies, {
			image: null,
			properties: workoutTemplateProperties,
			entitySchemaId: workoutTemplateSchema.id,
			name: `Workout Template ${crypto.randomUUID()}`,
		});

		const entity = await getEntity(client, cookies, workoutTemplate.id);

		expect(entity.properties).toMatchObject(workoutTemplateProperties);
		expect(entity.properties).not.toHaveProperty("comment");
		expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.note");
		expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.reps");
		expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.weight");
		expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.duration");
		expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.distance");
		expect(entity.properties).not.toHaveProperty("exercises.0.sets.0.rpe");
	});

	it("allows workout templates to be added to a collection", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const collection = await createCollection(client, cookies, {
			name: "Workout Templates",
			description: "Templates for the training plan",
		});
		const { workoutTemplateId } = await createWorkoutTemplateEntityFixture(client, cookies);

		const { data, response } = await client.POST("/collections/memberships", {
			headers: { Cookie: cookies },
			body: { entityId: workoutTemplateId, collectionId: collection.id },
		});

		expect(response.status).toBe(200);
		expect(data?.data.memberOf.sourceEntityId).toBe(workoutTemplateId);
		expect(data?.data.memberOf.targetEntityId).toBe(collection.id);
	});

	it("joins a workout to its template through the seeded relationship schema", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema: workoutSchema } = await findBuiltinSchemaBySlug(client, cookies, "workout");
		const { workoutTemplateId, workoutTemplate } = await createWorkoutTemplateEntityFixture(
			client,
			cookies,
		);
		const workoutName = `Workout ${crypto.randomUUID()}`;
		const { id: workoutId } = await createEntity(client, cookies, {
			image: null,
			name: workoutName,
			entitySchemaId: workoutSchema.id,
			properties: {
				comment: "Leg day",
				caloriesBurnt: 420,
				endedAt: "2026-04-27T11:00:00Z",
				startedAt: "2026-04-27T10:00:00Z",
			},
		});
		const relationshipSchemaId = await findBuiltinRelationshipSchemaId(
			"workout-to-workout-template",
		);

		await insertRelationshipRow({
			userId,
			relationshipSchemaId,
			sourceEntityId: workoutId,
			targetEntityId: workoutTemplateId,
		});

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: ["workout"],
			pagination: { page: 1, limit: 10 },
			sort: { direction: "asc", expression: createEntityColumnExpression("workout", "name") },
			relationshipJoins: [
				buildLatestRelationshipJoin({
					required: true,
					key: "template",
					direction: "outgoing",
					relationshipSchemaSlug: "workout-to-workout-template",
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField("workout", "name")]),
				buildQueryEngineField("templateId", [
					relationshipJoinField("template", "targetEntity", "id"),
				]),
				buildQueryEngineField("templateName", [
					relationshipJoinField("template", "targetEntity", "name"),
				]),
			],
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(workoutName),
				left: createEntityColumnExpression("workout", "name"),
			},
		});

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "templateId")).toEqual({
			kind: "text",
			key: "templateId",
			value: workoutTemplateId,
		});
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "templateName")).toEqual({
			kind: "text",
			key: "templateName",
			value: workoutTemplate.name,
		});
	});

	it("joins a workout from the template side through the seeded relationship schema", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema: workoutSchema } = await findBuiltinSchemaBySlug(client, cookies, "workout");
		const { workoutTemplateId, workoutTemplate } = await createWorkoutTemplateEntityFixture(
			client,
			cookies,
		);
		const workoutName = `Workout ${crypto.randomUUID()}`;
		const { id: workoutId } = await createEntity(client, cookies, {
			image: null,
			name: workoutName,
			entitySchemaId: workoutSchema.id,
			properties: {
				comment: "Leg day",
				caloriesBurnt: 420,
				endedAt: "2026-04-27T11:00:00Z",
				startedAt: "2026-04-27T10:00:00Z",
			},
		});
		const relationshipSchemaId = await findBuiltinRelationshipSchemaId(
			"workout-to-workout-template",
		);

		await insertRelationshipRow({
			userId,
			relationshipSchemaId,
			sourceEntityId: workoutId,
			targetEntityId: workoutTemplateId,
		});

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			mode: "entities",
			computedFields: [],
			scope: ["workout-template"],
			pagination: { page: 1, limit: 10 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression("workout-template", "name"),
			},
			relationshipJoins: [
				buildLatestRelationshipJoin({
					key: "workout",
					required: true,
					direction: "incoming",
					relationshipSchemaSlug: "workout-to-workout-template",
				}),
			],
			fields: [
				buildQueryEngineField("title", [entityField("workout-template", "name")]),
				buildQueryEngineField("workoutId", [
					relationshipJoinField("workout", "sourceEntity", "id"),
				]),
				buildQueryEngineField("workoutName", [
					relationshipJoinField("workout", "sourceEntity", "name"),
				]),
			],
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(workoutTemplate.name),
				left: createEntityColumnExpression("workout-template", "name"),
			},
		});

		expect(response.status).toBe(200);
		expect(data.data.items).toHaveLength(1);
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "workoutId")).toEqual({
			kind: "text",
			key: "workoutId",
			value: workoutId,
		});
		expect(getQueryEngineFieldOrThrow(data.data.items[0], "workoutName")).toEqual({
			kind: "text",
			key: "workoutName",
			value: workoutName,
		});
	});
});
