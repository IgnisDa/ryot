import { describe, expect, it } from "bun:test";

import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/app-backend/query-language";

import {
	buildGridRequest,
	createAuthenticatedClient,
	createWorkoutEntityFixture,
	entityField,
	executeQueryEngine,
	findBuiltinRelationshipSchemaId,
	findBuiltinSchemaBySlug,
	findBuiltinTrackerBySlug,
	findWorkoutSetEventSchema,
	getEntity,
	getQueryEngineFieldOrThrow,
	insertRelationshipRow,
	listEntitySchemas,
	listSavedViews,
	waitForEventCount,
	waitForSeededExerciseId,
	waitForSessionEventCount,
} from "../fixtures";
import { getPgClient } from "../setup";
import { assertTaggedError } from "../test-support/assertions";

describe("Workouts E2E", () => {
	it("links the built-in workout schema to the fitness tracker", async () => {
		const { client } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(client, "fitness");
		const schemas = await listEntitySchemas(client, {
			trackerId: fitnessTracker.id,
		});
		const workoutSchema = schemas.find((schema) => schema.slug === "workout");

		expect(workoutSchema).toBeDefined();
		expect(workoutSchema?.name).toBe("Workout");
		expect(workoutSchema?.trackerId).toBe(fitnessTracker.id);
		expect(workoutSchema?.isBuiltin).toBe(true);
	});

	it("exposes the workout schema properties", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema: workoutSchema } = await findBuiltinSchemaBySlug(client, "workout");

		expect(workoutSchema.propertiesSchema.fields).toMatchObject({
			comment: {
				label: "Comment",
				type: "string",
				description: "Optional notes or comments about this workout",
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
	});

	it("creates the built-in All Workouts saved view with workout defaults", async () => {
		const { client } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(client, "fitness");
		const views = await listSavedViews(client, {
			trackerId: fitnessTracker.id,
		});
		const allWorkoutsView = views.find((view) => view.name === "All Workouts");

		expect(allWorkoutsView).toBeDefined();
		expect(allWorkoutsView).toMatchObject({
			isBuiltin: true,
			name: "All Workouts",
			trackerId: fitnessTracker.id,
			queryDefinition: {
				scope: ["workout"],
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression("workout", "name"),
				},
			},
			displayConfiguration: {
				grid: {
					calloutProperty: null,
					titleProperty: createEntityColumnExpression("workout", "name"),
					imageProperty: createEntityColumnExpression("workout", "image"),
					primarySubtitleProperty: createEntityPropertyExpression("workout", "startedAt"),
					secondarySubtitleProperty: createEntityPropertyExpression("workout", "endedAt"),
				},
			},
		});
	});

	it("creates a workout entity and retrieves it by id", async () => {
		const { client } = await createAuthenticatedClient();
		const { workoutId } = await createWorkoutEntityFixture(client);
		const entity = await getEntity(client, workoutId);

		expect(entity.id).toBe(workoutId);
		expect(entity.properties).toMatchObject({
			endedAt: "2026-04-27T11:00:00Z",
			startedAt: "2026-04-27T10:00:00Z",
		});
	});

	it("shows workout entities through the All Workouts saved-view defaults", async () => {
		const { client } = await createAuthenticatedClient();
		await createWorkoutEntityFixture(client);

		const result = await executeQueryEngine(
			client,
			buildGridRequest({
				scope: ["workout"],
				pagination: { page: 1, limit: 10 },
				displayConfiguration: {
					calloutProperty: null,
					titleProperty: [entityField("workout", "name")],
					imageProperty: [entityField("workout", "image")],
					primarySubtitleProperty: [entityField("workout", "startedAt")],
					secondarySubtitleProperty: [entityField("workout", "endedAt")],
				},
			}),
		);

		expect(result.data.data.items.length).toBeGreaterThan(0);
		expect(getQueryEngineFieldOrThrow(result.data.data.items[0], "primarySubtitle").key).toBe(
			"primarySubtitle",
		);
	});

	it("logs a workout set linked to a workout via sessionEntityId", async () => {
		const { client } = await createAuthenticatedClient();
		const { workoutId } = await createWorkoutEntityFixture(client);
		const { workoutSetEventSchema } = await findWorkoutSetEventSchema(client);
		const exerciseId = await waitForSeededExerciseId(client);

		const createResult = await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId: exerciseId,
						sessionEntityId: workoutId,
						eventSchemaId: workoutSetEventSchema.id,
						properties: {
							reps: 10,
							weight: 60,
							setOrder: 0,
							setLot: "normal",
							exerciseOrder: 0,
						},
					},
				],
			}),
		);

		expect(createResult.count).toBe(1);

		const events = await waitForSessionEventCount(client, workoutId, 1);
		expect(events[0]?.sessionEntityId).toBe(workoutId);
		expect(events[0]?.entityId).toBe(exerciseId);
	});

	it("listing events by sessionEntityId returns only sets for that workout", async () => {
		const { client } = await createAuthenticatedClient();
		const { workoutId: workoutOneId } = await createWorkoutEntityFixture(client);
		const { workoutId: workoutTwoId } = await createWorkoutEntityFixture(client);
		const { workoutSetEventSchema } = await findWorkoutSetEventSchema(client);
		const exerciseId = await waitForSeededExerciseId(client);

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId: exerciseId,
						sessionEntityId: workoutOneId,
						eventSchemaId: workoutSetEventSchema.id,
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
						eventSchemaId: workoutSetEventSchema.id,
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
						eventSchemaId: workoutSetEventSchema.id,
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

		const workoutOneEvents = await waitForSessionEventCount(client, workoutOneId, 2);
		expect(workoutOneEvents).toHaveLength(2);
		expect(workoutOneEvents.every((event) => event.sessionEntityId === workoutOneId)).toBe(true);
	});

	it("listing events by entityId spans multiple workouts for the same exercise", async () => {
		const { client } = await createAuthenticatedClient();
		const { workoutId: workoutOneId } = await createWorkoutEntityFixture(client);
		const { workoutId: workoutTwoId } = await createWorkoutEntityFixture(client);
		const { workoutSetEventSchema } = await findWorkoutSetEventSchema(client);
		const exerciseId = await waitForSeededExerciseId(client);

		await client.run((c) =>
			c.events.create({
				payload: [
					{
						entityId: exerciseId,
						sessionEntityId: workoutOneId,
						eventSchemaId: workoutSetEventSchema.id,
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
						eventSchemaId: workoutSetEventSchema.id,
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

		const exerciseEvents = await waitForEventCount(client, exerciseId, 2);
		expect(exerciseEvents).toHaveLength(2);
		expect(new Set(exerciseEvents.map((event) => event.sessionEntityId))).toEqual(
			new Set([workoutOneId, workoutTwoId]),
		);
	});

	it("returns 400 when listing events without entityId or sessionEntityId", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) => c.events.list({ urlParams: {} }));

		assertTaggedError(error, "BadRequest");
	});

	it("creates a workout-repeated-from relationship between two workouts", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { workoutId: originalWorkoutId } = await createWorkoutEntityFixture(client);
		const { workoutId: copiedWorkoutId } = await createWorkoutEntityFixture(client);

		const relationshipSchemaId = await findBuiltinRelationshipSchemaId(
			client,
			"workout-repeated-from",
		);

		await insertRelationshipRow({
			userId,
			relationshipSchemaId,
			sourceEntityId: copiedWorkoutId,
			targetEntityId: originalWorkoutId,
		});

		const result = await getPgClient().query<{
			source_entity_id: string;
			target_entity_id: string;
		}>(
			`select r.source_entity_id, r.target_entity_id
			 from relationship r
			 where r.relationship_schema_id = $1
			   and r.user_id = $2
			   and r.source_entity_id = $3
			   and r.target_entity_id = $4`,
			[relationshipSchemaId, userId, copiedWorkoutId, originalWorkoutId],
		);

		expect(result.rows).toHaveLength(1);
		const row = result.rows[0];
		expect(row).toBeDefined();
		if (!row) {
			return;
		}
		expect(row.source_entity_id).toBe(copiedWorkoutId);
		expect(row.target_entity_id).toBe(originalWorkoutId);
	});
});
