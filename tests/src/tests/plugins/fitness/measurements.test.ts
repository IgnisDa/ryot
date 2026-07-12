import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/contract/display-configuration";
import { buildMeasurementListQueryDocument } from "@ryot/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createMeasurementEntityFixture,
	executeRyotQL,
	findBuiltinSchemaBySlug,
	findBuiltinPluginBySlug,
	getEntity,
	listEntitySchemas,
	listSavedViews,
	requireRyotQLFieldValue,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Measurements E2E", () => {
	it.live("links the built-in measurement schema to the fitness plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
			const schemas = yield* listEntitySchemas(client, {
				pluginSlug: fitnessPlugin.slug,
			});
			const measurementSchema = schemas.find((schema) => schema.slug === "measurement");

			expect(measurementSchema).toBeDefined();
			expect(measurementSchema?.name).toBe("Measurement");
			expect(measurementSchema?.isBuiltin).toBe(true);
			expect(measurementSchema?.pluginSlug).toBe(fitnessPlugin.slug);
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
				const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
				const views = yield* listSavedViews(client, {
					pluginSlug: fitnessPlugin.slug,
				});
				const allMeasurementsView = views.find((view) => view.name === "All Measurements");

				expect(allMeasurementsView).toBeDefined();
				expect(allMeasurementsView).toMatchObject({
					isBuiltin: true,
					name: "All Measurements",
					pluginSlug: fitnessPlugin.slug,
					queryDocument: {
						queries: {
							savedView: {
								output: {
									orderBy: [{ direction: "desc", expr: { type: "cast", target: "date" } }],
								},
								where: {
									right: { value: "measurement" },
									left: { field: "entitySchemaSlug", tableAlias: "entity" },
								},
							},
						},
					},
					displayConfiguration: {
						grid: {
							imageProperty: null,
							calloutProperty: null,
							titleProperty: createEntityColumnExpression("measurement", "name"),
							secondarySubtitleProperty: createEntityPropertyExpression("measurement", "comment"),
							primarySubtitleProperty: createEntityPropertyExpression("measurement", "recordedAt"),
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

			const result = yield* executeRyotQL(client, buildMeasurementListQueryDocument({}));
			const measurements = result.data["measurements"];
			if (measurements?.type !== "rows") {
				throw new Error("Expected measurements rows result");
			}

			const firstItem = measurements.items[0];
			assertPresent(firstItem, "Expected at least one measurement item");
			expect(measurements.items.length).toBeGreaterThan(0);
			expect(requireRyotQLFieldValue(firstItem, "recordedAt")).toMatchObject({
				kind: "date",
			});
		}),
	);
});
