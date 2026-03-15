import type { FieldSelection } from "@ryot/contract/modules/ryotql/language";
import { buildMeasurementListQueryDocument } from "@ryot/fitness-plugin/query-recipes";
import { column, field, jsonPath, literal, table } from "@ryot/ryotql";
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
	requireRows,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const savedViewEntity = table("entity", "entity");
const expectedSavedViewFields = [
	field("entityId", column(savedViewEntity, "id")),
	field("gridTitle", column(savedViewEntity, "name")),
	field("gridEyebrow", literal("Measurement")),
	field("gridPrimarySubtitle", jsonPath(column(savedViewEntity, "properties"), "recordedAt")),
	field("gridSecondarySubtitle", jsonPath(column(savedViewEntity, "properties"), "comment")),
	field("listTitle", column(savedViewEntity, "name")),
	field("listEyebrow", literal("Measurement")),
	field("listPrimarySubtitle", jsonPath(column(savedViewEntity, "properties"), "recordedAt")),
	field("listSecondarySubtitle", jsonPath(column(savedViewEntity, "properties"), "comment")),
	field("tableColumn0", column(savedViewEntity, "name")),
	field("tableColumn1", jsonPath(column(savedViewEntity, "properties"), "comment")),
	field("tableColumn2", jsonPath(column(savedViewEntity, "properties"), "recordedAt")),
] satisfies readonly FieldSelection[];

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
				const savedViewQuery = allMeasurementsView.queryDocument.queries.savedView;
				assertPresent(savedViewQuery, "Expected the All Measurements saved-view query");
				if (savedViewQuery.output.type !== "rows") {
					throw new Error("Expected the All Measurements saved-view query to use rows output");
				}

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
							imageField: null,
							calloutField: null,
							titleField: "gridTitle",
							eyebrowField: "gridEyebrow",
							secondarySubtitleField: "gridSecondarySubtitle",
							primarySubtitleField: "gridPrimarySubtitle",
						},
						list: {
							imageField: null,
							calloutField: null,
							titleField: "listTitle",
							eyebrowField: "listEyebrow",
							secondarySubtitleField: "listSecondarySubtitle",
							primarySubtitleField: "listPrimarySubtitle",
						},
						entityIdField: "entityId",
						table: {
							columns: [
								{ label: "Name", field: "tableColumn0" },
								{ label: "Comment", field: "tableColumn1" },
								{ label: "Recorded At", field: "tableColumn2" },
							],
						},
					},
				});
				expect(savedViewQuery.output.fields).toEqual(expectedSavedViewFields);
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

			const result = yield* executeRyotQL(client, buildMeasurementListQueryDocument({}));
			const measurements = requireRows(result.data["measurements"], "measurements");

			const firstItem = measurements.items[0];
			assertPresent(firstItem, "Expected at least one measurement item");
			expect(measurements.items.length).toBeGreaterThan(0);
			expect(requireRyotQLFieldValue(firstItem, "recordedAt")).toMatchObject({
				kind: "date",
			});
		}),
	);
});
