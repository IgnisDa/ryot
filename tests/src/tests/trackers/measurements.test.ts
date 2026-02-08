import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/contract/display-configuration";
import { buildMeasurementListQueryDocument } from "@ryot/query-engine/recipes/fitness";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createMeasurementEntityFixture,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	findBuiltinTrackerBySlug,
	getEntity,
	getQueryEngineFieldOrThrow,
	listEntitySchemas,
	listSavedViews,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("Measurements E2E", () => {
	it.live("links the built-in measurement schema to the fitness tracker", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessTracker = yield* findBuiltinTrackerBySlug(client, "fitness");
			const schemas = yield* listEntitySchemas(client, {
				trackerSlug: fitnessTracker.id,
			});
			const measurementSchema = schemas.find((schema) => schema.slug === "measurement");

			expect(measurementSchema).toBeDefined();
			expect(measurementSchema?.name).toBe("Measurement");
			expect(measurementSchema?.isBuiltin).toBe(true);
			expect(measurementSchema?.trackerSlug).toBe(fitnessTracker.id);
		}),
	);

	it.live("exposes the measurement schema properties with uniform statistics", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: measurementSchema } = yield* findBuiltinSchemaBySlug(client, "measurement");

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
		}),
	);

	it.live(
		"creates the built-in All Measurements saved view with recordedAt sort and comment subtitle",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const fitnessTracker = yield* findBuiltinTrackerBySlug(client, "fitness");
				const views = yield* listSavedViews(client, {
					trackerSlug: fitnessTracker.id,
				});
				const allMeasurementsView = views.find((view) => view.name === "All Measurements");

				expect(allMeasurementsView).toBeDefined();
				expect(allMeasurementsView).toMatchObject({
					isBuiltin: true,
					name: "All Measurements",
					trackerSlug: fitnessTracker.id,
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
							imageProperty: null,
							titleProperty: createEntityColumnExpression("measurement", "name"),
							primarySubtitleProperty: createEntityPropertyExpression("measurement", "recordedAt"),
							secondarySubtitleProperty: createEntityPropertyExpression("measurement", "comment"),
						},
					},
				});
			}),
	);

	it.live("creates a measurement entity with statistics and retrieves it by id", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { measurementId } = yield* createMeasurementEntityFixture(client);
			const entity = yield* getEntity(client, measurementId);

			expect(entity.id).toBe(measurementId);
			expect(entity.name).toBe("Measurement - 2026-04-27 08:00");
			expect(entity.properties).toMatchObject({
				statistics: [{ key: "weight", label: "Weight", value: 75.5 }],
				recordedAt: expect.stringMatching(/^2026-04-27T08:00:00(\.\d+)?Z$/),
			});
			expect(entity.properties).not.toHaveProperty("weight");
		}),
	);

	it.live("shows measurement entities through the query engine", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* createMeasurementEntityFixture(client);

			const result = yield* executeQueryEngine(client, buildMeasurementListQueryDocument({}));

			expect(result.data.items.length).toBeGreaterThan(0);
			expect(getQueryEngineFieldOrThrow(result.data.items[0], "recordedAt").key).toBe("recordedAt");
		}),
	);
});
