import { describe, expect, it } from "bun:test";
import type { Client } from "../fixtures";
import {
	createAuthenticatedClient,
	entityColumnExpression,
	listEntitySchemas,
	listSavedViews,
	listTrackers,
	schemaPropertyExpression,
} from "../fixtures";

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
		expect(exerciseSchema?.providers).toHaveLength(1);
		expect(exerciseSchema?.providers[0]).toMatchObject({
			name: "Free Exercise DB",
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
});
