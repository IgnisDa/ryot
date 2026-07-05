import { measurementListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	findBuiltinPluginBySlug,
	getEntity,
	listEntitySchemas,
	listSavedViews,
} from "~/fixtures/kernel";
import { createMeasurementEntityFixture } from "~/fixtures/plugins/fitness";
import { assertCondition, assertPresent, requirePresent } from "~/support/assertions";
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
				assertPresent(allMeasurementsView, "Expected the built-in All Measurements saved view");
				const allMeasurementsLayouts = requirePresent(
					allMeasurementsView.layouts,
					"All Measurements saved view has no layouts",
				);
				const savedViewQuery = allMeasurementsLayouts.grid.queryDocument.queries.savedView;
				assertPresent(savedViewQuery, "Expected the All Measurements saved-view query");
				assertCondition(
					savedViewQuery.output.type === "rows",
					"Expected the All Measurements saved-view query to use rows output",
				);

				expect(allMeasurementsView).toMatchObject({
					isBuiltin: true,
					name: "All Measurements",
					pluginSlug: fitnessPlugin.slug,
					layouts: {
						grid: {
							imageField: null,
							titleField: "title",
							entityIdField: "entityId",
							callout: null,
							overline: { field: "overline", displayKind: "text" },
							primaryMetadata: { field: "primaryMetadata", displayKind: "date" },
							secondaryMetadata: { field: "secondaryMetadata", displayKind: "text" },
						},
						list: {
							imageField: null,
							titleField: "title",
							entityIdField: "entityId",
							callout: null,
							overline: { field: "overline", displayKind: "text" },
							primaryMetadata: { field: "primaryMetadata", displayKind: "date" },
							secondaryMetadata: { field: "secondaryMetadata", displayKind: "text" },
						},
						table: {
							imageField: null,
							entityIdField: "entityId",
							columns: [
								{ label: "Name", field: "column0", displayKind: "text" },
								{ label: "Comment", field: "column1", displayKind: "text" },
								{ label: "Recorded At", field: "column2", displayKind: "date" },
							],
						},
					},
				});
				expect(savedViewQuery).toMatchObject({
					output: { orderBy: [{ direction: "desc", expr: { type: "cast", target: "date" } }] },
					where: {
						right: { value: "measurement" },
						left: { field: "entitySchemaSlug", tableAlias: "entity" },
					},
				});
				expect(
					savedViewQuery.output.fields.map((selection) => "key" in selection && selection.key),
				).toEqual([
					"entityId",
					"title",
					"overline",
					"primaryMetadata",
					"secondaryMetadata",
					"populationStatus",
					"translationStatus",
				]);
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

	it.live("shows measurement entities through RyotQL", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* createMeasurementEntityFixture(client);

			const result = yield* executeRyotQLRecipe(client, measurementListRecipe({}));

			const firstItem = result.items[0];
			assertPresent(firstItem, "Expected at least one measurement item");
			expect(result.items.length).toBeGreaterThan(0);
			expect(firstItem.recordedAt).toEqual(expect.any(String));
		}),
	);
});
