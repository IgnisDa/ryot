import { describe, expect, it } from "bun:test";

import { createEntityColumnExpression, createEntityPropertyExpression } from "@ryot/ts-utils";

import {
	buildGridRequest,
	createAuthenticatedClient,
	createMeasurementEntityFixture,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	findBuiltinTrackerBySlug,
	getEntity,
	getQueryEngineFieldOrThrow,
	listEntitySchemas,
	listSavedViews,
} from "../fixtures";

describe("Measurements E2E", () => {
	it("links the built-in measurement schema to the fitness tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(client, cookies, "fitness");
		const schemas = await listEntitySchemas(client, cookies, {
			trackerId: fitnessTracker.id,
		});
		const measurementSchema = schemas.find((schema) => schema.slug === "measurement");

		expect(measurementSchema).toBeDefined();
		expect(measurementSchema?.name).toBe("Measurement");
		expect(measurementSchema?.isBuiltin).toBe(true);
		expect(measurementSchema?.trackerId).toBe(fitnessTracker.id);
	});

	it("exposes the measurement schema properties", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema: measurementSchema } = await findBuiltinSchemaBySlug(
			client,
			cookies,
			"measurement",
		);

		expect(measurementSchema.propertiesSchema.fields).toMatchObject({
			weight: {
				type: "number",
				label: "Weight",
				description: "Body weight in the user's preferred unit",
			},
			comment: {
				type: "string",
				label: "Comment",
				description: "Optional notes about this measurement",
			},
			recordedAt: {
				type: "datetime",
				label: "Recorded At",
				description: "Date and time this measurement was recorded",
			},
		});
	});

	it("creates the built-in All Measurements saved view with measurement defaults", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const fitnessTracker = await findBuiltinTrackerBySlug(client, cookies, "fitness");
		const views = await listSavedViews(client, cookies, {
			trackerId: fitnessTracker.id,
		});
		const allMeasurementsView = views.find((view) => view.name === "All Measurements");

		expect(allMeasurementsView).toBeDefined();
		expect(allMeasurementsView).toMatchObject({
			isBuiltin: true,
			name: "All Measurements",
			trackerId: fitnessTracker.id,
			queryDefinition: {
				scope: ["measurement"],
				sort: {
					direction: "asc",
					expression: createEntityColumnExpression("measurement", "name"),
				},
			},
			displayConfiguration: {
				grid: {
					calloutProperty: null,
					titleProperty: createEntityColumnExpression("measurement", "name"),
					imageProperty: createEntityColumnExpression("measurement", "image"),
					primarySubtitleProperty: createEntityPropertyExpression("measurement", "recordedAt"),
					secondarySubtitleProperty: createEntityPropertyExpression("measurement", "weight"),
				},
			},
		});
	});

	it("creates a measurement entity and retrieves it by id", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { measurementId } = await createMeasurementEntityFixture(client, cookies);
		const entity = await getEntity(client, cookies, measurementId);

		expect(entity.id).toBe(measurementId);
		expect(entity.name).toBe("2026-04-27");
		expect(entity.properties).toMatchObject({
			weight: 75.5,
			recordedAt: "2026-04-27T08:00:00Z",
		});
	});

	it("shows measurement entities through the query engine", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		await createMeasurementEntityFixture(client, cookies);

		const result = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				scope: ["measurement"],
				pagination: { page: 1, limit: 10 },
				displayConfiguration: {
					calloutProperty: null,
					titleProperty: ["entity.measurement.name"],
					imageProperty: ["entity.measurement.image"],
					primarySubtitleProperty: ["entity.measurement.properties.recordedAt"],
					secondarySubtitleProperty: ["entity.measurement.properties.weight"],
				},
			}),
		);

		expect(result.response.status).toBe(200);
		expect(result.data?.data.items.length).toBeGreaterThan(0);
		expect(getQueryEngineFieldOrThrow(result.data?.data.items[0], "primarySubtitle").key).toBe(
			"primarySubtitle",
		);
	});
});
