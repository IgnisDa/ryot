import { describe, expect, it } from "bun:test";

import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/app-backend/display-configuration";

import {
	buildEntityRowsQueryDocument,
	createAuthenticatedClient,
	createMeasurementEntityFixture,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	findBuiltinTrackerBySlug,
	getEntity,
	getQueryEngineFieldOrThrow,
	listEntitySchemas,
	listSavedViews,
	propertyRef,
	systemRef,
} from "../fixtures";

describe("Measurements E2E", () => {
	it("links the built-in measurement schema to the fitness tracker", async () => {
		const { client } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(client, "fitness");
		const schemas = await listEntitySchemas(client, {
			trackerId: fitnessTracker.id,
		});
		const measurementSchema = schemas.find((schema) => schema.slug === "measurement");

		expect(measurementSchema).toBeDefined();
		expect(measurementSchema?.name).toBe("Measurement");
		expect(measurementSchema?.isBuiltin).toBe(true);
		expect(measurementSchema?.trackerId).toBe(fitnessTracker.id);
	});

	it("exposes the measurement schema properties with uniform statistics", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema: measurementSchema } = await findBuiltinSchemaBySlug(client, "measurement");

		expect(measurementSchema.propertiesSchema.fields).toMatchObject({
			comment: {
				type: "string",
				label: "Comment",
				description: "Optional notes about this measurement",
			},
			statistics: {
				type: "array",
				label: "Statistics",
				description: "Array of measurement statistics",
			},
			recordedAt: {
				type: "datetime",
				label: "Recorded At",
				description: "Date and time this measurement was recorded",
			},
		});
		expect(measurementSchema.propertiesSchema.fields).not.toHaveProperty("weight");
	});

	it("creates the built-in All Measurements saved view with recordedAt sort and comment subtitle", async () => {
		const { client } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(client, "fitness");
		const views = await listSavedViews(client, {
			trackerId: fitnessTracker.id,
		});
		const allMeasurementsView = views.find((view) => view.name === "All Measurements");

		expect(allMeasurementsView).toBeDefined();
		expect(allMeasurementsView).toMatchObject({
			isBuiltin: true,
			name: "All Measurements",
			trackerId: fitnessTracker.id,
			queryDocument: {
				source: { schemas: ["measurement"] },
				output: {
					orderBy: [
						{
							order: "desc",
							expr: {
								type: "ref",
								sourceAlias: "entity",
								field: { type: "property", schema: "measurement", path: ["recordedAt"] },
							},
						},
					],
				},
			},
			displayConfiguration: {
				grid: {
					calloutProperty: null,
					titleProperty: createEntityColumnExpression("measurement", "name"),
					imageProperty: createEntityColumnExpression("measurement", "image"),
					primarySubtitleProperty: createEntityPropertyExpression("measurement", "recordedAt"),
					secondarySubtitleProperty: createEntityPropertyExpression("measurement", "comment"),
				},
			},
		});
	});

	it("creates a measurement entity with statistics and retrieves it by id", async () => {
		const { client } = await createAuthenticatedClient();
		const { measurementId } = await createMeasurementEntityFixture(client);
		const entity = await getEntity(client, measurementId);

		expect(entity.id).toBe(measurementId);
		expect(entity.name).toBe("Measurement - 2026-04-27 08:00");
		expect(entity.properties).toMatchObject({
			statistics: [{ key: "weight", label: "Weight", value: 75.5 }],
			recordedAt: expect.stringMatching(/^2026-04-27T08:00:00(\.\d+)?Z$/),
		});
		expect(entity.properties).not.toHaveProperty("weight");
	});

	it("shows measurement entities through the query engine", async () => {
		const { client } = await createAuthenticatedClient();
		await createMeasurementEntityFixture(client);

		const result = await executeQueryEngine(
			client,
			buildEntityRowsQueryDocument({
				alias: "measurement",
				schemas: ["measurement"],
				fields: [
					{ key: "title", expr: systemRef("measurement", "name") },
					{ key: "image", expr: systemRef("measurement", "image") },
					{
						key: "primarySubtitle",
						expr: propertyRef("measurement", "measurement", "recordedAt"),
					},
					{
						key: "secondarySubtitle",
						expr: propertyRef("measurement", "measurement", "comment"),
					},
				],
			}),
		);

		expect(result.data.items.length).toBeGreaterThan(0);
		expect(getQueryEngineFieldOrThrow(result.data.items[0], "primarySubtitle").key).toBe(
			"primarySubtitle",
		);
	});
});
