import { describe, expect, it } from "bun:test";
import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/ts-utils";
import {
	buildGridRequest,
	createAuthenticatedClient,
	createWorkoutEntityFixture,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	findBuiltinTrackerBySlug,
	findWorkoutSetEventSchema,
	getEntity,
	getQueryEngineFieldOrThrow,
	listEntitySchemas,
	listSavedViews,
	waitForEventCount,
	waitForSeededExerciseId,
	waitForSessionEventCount,
} from "../fixtures";

describe("Workouts E2E", () => {
	it("links the built-in workout schema to the fitness tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(
			client,
			cookies,
			"fitness",
		);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: fitnessTracker.id,
		});
		const workoutSchema = schemas.find((schema) => schema.slug === "workout");

		expect(workoutSchema).toBeDefined();
		expect(workoutSchema?.name).toBe("Workout");
		expect(workoutSchema?.trackerId).toBe(fitnessTracker.id);
		expect(workoutSchema?.isBuiltin).toBe(true);
	});

	it("exposes the workout schema properties", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema: workoutSchema } = await findBuiltinSchemaBySlug(
			client,
			cookies,
			"workout",
		);

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
				type: "integer",
				label: "Calories Burnt",
				description: "Estimated calories burned during this workout",
			},
		});
	});

	it("creates the built-in All Workouts saved view with workout defaults", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(
			client,
			cookies,
			"fitness",
		);
		const views = await listSavedViews(client, cookies, {
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
					primarySubtitleProperty: createEntityPropertyExpression(
						"workout",
						"startedAt",
					),
					secondarySubtitleProperty: createEntityPropertyExpression(
						"workout",
						"endedAt",
					),
				},
			},
		});
	});

	it("creates a workout entity and retrieves it by id", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { workoutId } = await createWorkoutEntityFixture(client, cookies);
		const entity = await getEntity(client, cookies, workoutId);

		expect(entity.id).toBe(workoutId);
		expect(entity.properties).toMatchObject({
			endedAt: "2026-04-27T11:00:00Z",
			startedAt: "2026-04-27T10:00:00Z",
		});
	});

	it("shows workout entities through the All Workouts saved-view defaults", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		await createWorkoutEntityFixture(client, cookies);

		const result = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: ["workout"],
				pagination: { page: 1, limit: 10 },
				displayConfiguration: {
					calloutProperty: null,
					titleProperty: ["entity.workout.name"],
					imageProperty: ["entity.workout.image"],
					primarySubtitleProperty: ["entity.workout.properties.startedAt"],
					secondarySubtitleProperty: ["entity.workout.properties.endedAt"],
				},
			}),
		);

		expect(result.response.status).toBe(200);
		expect(result.data?.data.items.length).toBeGreaterThan(0);
		expect(
			getQueryEngineFieldOrThrow(result.data?.data.items[0], "primarySubtitle")
				.key,
		).toBe("primarySubtitle");
	});

	it("logs a workout set linked to a workout via sessionEntityId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { workoutId } = await createWorkoutEntityFixture(client, cookies);
		const { workoutSetEventSchema } = await findWorkoutSetEventSchema(
			client,
			cookies,
		);
		const exerciseId = await waitForSeededExerciseId(client, cookies);

		const createResult = await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
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
		});

		expect(createResult.response.status).toBe(200);
		expect(createResult.data?.data.count).toBe(1);

		const events = await waitForSessionEventCount(
			client,
			cookies,
			workoutId,
			1,
		);
		expect(events[0]?.sessionEntityId).toBe(workoutId);
		expect(events[0]?.entityId).toBe(exerciseId);
	});

	it("listing events by sessionEntityId returns only sets for that workout", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { workoutId: workoutOneId } = await createWorkoutEntityFixture(
			client,
			cookies,
		);
		const { workoutId: workoutTwoId } = await createWorkoutEntityFixture(
			client,
			cookies,
		);
		const { workoutSetEventSchema } = await findWorkoutSetEventSchema(
			client,
			cookies,
		);
		const exerciseId = await waitForSeededExerciseId(client, cookies);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
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
		});

		const workoutOneEvents = await waitForSessionEventCount(
			client,
			cookies,
			workoutOneId,
			2,
		);
		expect(workoutOneEvents).toHaveLength(2);
		expect(
			workoutOneEvents.every((event) => event.sessionEntityId === workoutOneId),
		).toBe(true);
	});

	it("listing events by entityId spans multiple workouts for the same exercise", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { workoutId: workoutOneId } = await createWorkoutEntityFixture(
			client,
			cookies,
		);
		const { workoutId: workoutTwoId } = await createWorkoutEntityFixture(
			client,
			cookies,
		);
		const { workoutSetEventSchema } = await findWorkoutSetEventSchema(
			client,
			cookies,
		);
		const exerciseId = await waitForSeededExerciseId(client, cookies);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
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
		});

		const exerciseEvents = await waitForEventCount(
			client,
			cookies,
			exerciseId,
			2,
		);
		expect(exerciseEvents).toHaveLength(2);
		expect(
			new Set(exerciseEvents.map((event) => event.sessionEntityId)),
		).toEqual(new Set([workoutOneId, workoutTwoId]));
	});

	it("returns 400 when listing events without entityId or sessionEntityId", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const result = await client.GET("/events", {
			headers: { Cookie: cookies },
		});

		expect(result.response.status).toBe(400);
	});
});
