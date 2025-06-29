import { describe, expect, it } from "bun:test";
import type { Client } from "../fixtures";
import {
	buildGridRequest,
	createAuthenticatedClient,
	entityColumnExpression,
	entityField,
	executeQueryEngine,
	getQueryEngineFieldOrThrow,
	listEntitySchemas,
	listSavedViews,
	listTrackers,
	literalExpression,
	schemaPropertyExpression,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";

const seededExerciseName = "3/4 Sit-Up";
const seededExerciseImageUrl =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/3_4_Sit-Up/0.jpg";

const findBuiltinTrackerBySlug = async (
	client: Client,
	cookies: string,
	slug: string,
) => {
	const trackers = await listTrackers(client, cookies, {
		includeDisabled: true,
	});
	const tracker = trackers.find(
		(entry) => entry.isBuiltin && entry.slug === slug,
	);

	if (!tracker) {
		throw new Error(`Built-in tracker '${slug}' not found`);
	}

	return tracker;
};

const waitForSeededExercise = async (client: Client, cookies: string) => {
	return pollUntil(
		`exercise '${seededExerciseName}' to be queryable`,
		async () => {
			const { data, response } = await executeQueryEngine(
				client,
				cookies,
				buildGridRequest({
					entitySchemaSlugs: ["exercise"],
					pagination: { page: 1, limit: 1 },
					displayConfiguration: {
						calloutProperty: [entityField("exercise", "level")],
						titleProperty: [entityField("exercise", "name")],
						imageProperty: [entityField("exercise", "image")],
						primarySubtitleProperty: [entityField("exercise", "lot")],
						secondarySubtitleProperty: [entityField("exercise", "equipment")],
					},
					filter: {
						operator: "eq",
						type: "comparison",
						right: literalExpression(seededExerciseName),
						left: entityColumnExpression("exercise", "name"),
					},
				}),
			);

			if (response.status !== 200 || !data?.data) {
				throw new Error("Failed to query seeded exercises");
			}

			return data.data.items[0] ?? null;
		},
		{ intervalMs: 1000, timeoutMs: 60000 },
	);
};

describe("Exercises E2E", () => {
	it("links the built-in exercise schema to the fitness tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(
			client,
			cookies,
			"fitness",
		);
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: fitnessTracker.id,
		});
		const exerciseSchema = schemas.find((schema) => schema.slug === "exercise");

		expect(exerciseSchema).toBeDefined();
		expect(exerciseSchema?.name).toBe("Exercise");
		expect(exerciseSchema?.slug).toBe("exercise");
		expect(exerciseSchema?.icon).toBe("dumbbell");
		expect(exerciseSchema?.isBuiltin).toBe(true);
		expect(exerciseSchema?.trackerId).toBe(fitnessTracker.id);
		expect(exerciseSchema?.accentColor).toBe("#2DD4BF");
		expect(exerciseSchema?.providers).toEqual([]);
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
		expect(exerciseSchema?.propertiesSchema.fields.source).toMatchObject({
			type: "enum",
			label: "Source",
			options: ["github", "custom"],
		});
	});

	it("creates the built-in All Exercises saved view with exercise defaults", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(
			client,
			cookies,
			"fitness",
		);
		const views = await listSavedViews(client, cookies, {
			trackerId: fitnessTracker.id,
		});
		const allExercisesView = views.find(
			(view) => view.name === "All Exercises",
		);

		expect(allExercisesView).toBeDefined();
		expect(allExercisesView).toMatchObject({
			isBuiltin: true,
			name: "All Exercises",
			trackerId: fitnessTracker.id,
			queryDefinition: {
				filter: null,
				eventJoins: [],
				entitySchemaSlugs: ["exercise"],
			},
			displayConfiguration: {
				table: {
					columns: [
						{
							label: "Name",
							expression: entityColumnExpression("exercise", "name"),
						},
						{
							label: "Level",
							expression: schemaPropertyExpression("exercise", "level"),
						},
						{
							label: "Equipment",
							expression: schemaPropertyExpression("exercise", "equipment"),
						},
					],
				},
				grid: {
					titleProperty: entityColumnExpression("exercise", "name"),
					imageProperty: entityColumnExpression("exercise", "image"),
					calloutProperty: schemaPropertyExpression("exercise", "level"),
					primarySubtitleProperty: schemaPropertyExpression("exercise", "lot"),
					secondarySubtitleProperty: schemaPropertyExpression(
						"exercise",
						"equipment",
					),
				},
				list: {
					titleProperty: entityColumnExpression("exercise", "name"),
					imageProperty: entityColumnExpression("exercise", "image"),
					calloutProperty: schemaPropertyExpression("exercise", "level"),
					primarySubtitleProperty: schemaPropertyExpression("exercise", "lot"),
					secondarySubtitleProperty: schemaPropertyExpression(
						"exercise",
						"equipment",
					),
				},
			},
		});
	});

	it("lists seeded built-in exercises through the query engine", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const exercise = await waitForSeededExercise(client, cookies);

		expect(exercise.name).toBe(seededExerciseName);
		expect(exercise.entitySchemaSlug).toBe("exercise");
		expect(exercise.sandboxScriptId).toBeNull();
		expect(exercise.image).toEqual({
			kind: "remote",
			url: seededExerciseImageUrl,
		});
		expect(getQueryEngineFieldOrThrow(exercise, "title")).toEqual({
			key: "title",
			kind: "text",
			value: seededExerciseName,
		});
		expect(getQueryEngineFieldOrThrow(exercise, "image")).toEqual({
			key: "image",
			kind: "image",
			value: { kind: "remote", url: seededExerciseImageUrl },
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
});
