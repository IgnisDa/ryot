import { measurementReadingListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	findBuiltinPluginBySlug,
	listEntitySchemas,
	listEventSchemas,
	listSavedViews,
	requireEventSchemaBySlug,
} from "~/fixtures/kernel";
import { createMeasurementReadingFixture } from "~/fixtures/plugins/fitness";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Measurements E2E", () => {
	it.live("links the built-in metric schema to the fitness plugin and drops the old schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
			const schemas = yield* listEntitySchemas(client, { pluginSlug: fitnessPlugin.slug });
			const metricSchema = schemas.find((schema) => schema.slug === "measurement-metric");

			expect(metricSchema?.name).toBe("Measurement Metric");
			expect(metricSchema?.isBuiltin).toBe(true);
			expect(metricSchema?.pluginSlug).toBe(fitnessPlugin.slug);
		}),
	);

	it.live("exposes the metric and reading schema properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: metricSchema } = yield* findBuiltinSchemaBySlug(client, "measurement-metric");
			const readingSchema = requireEventSchemaBySlug(
				yield* listEventSchemas(client, metricSchema.id),
				"measurement-reading",
			);

			expect(metricSchema.propertiesSchema.fields).toMatchObject({
				unit: { label: "Unit", type: "string" },
				key: { label: "Key", type: "string", validation: { required: true } },
			});
			expect(readingSchema.propertiesSchema.fields).toMatchObject({
				comment: { type: "string", label: "Comment" },
				value: { label: "Value", type: "number", validation: { required: true } },
			});
		}),
	);

	it.live(
		"creates the built-in All Measurements saved view rendered by the measurements page",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const fitnessPlugin = yield* findBuiltinPluginBySlug(client, "fitness");
				const views = yield* listSavedViews(client, { pluginSlug: fitnessPlugin.slug });
				const allMeasurementsView = views.find((view) => view.name === "All Measurements");
				assertPresent(allMeasurementsView, "Expected the built-in All Measurements saved view");

				expect(allMeasurementsView).toMatchObject({
					settings: {},
					isBuiltin: true,
					dataSources: null,
					name: "All Measurements",
					pluginSlug: fitnessPlugin.slug,
					renderer: { kind: "plugin", exportName: "measurements" },
				});
			}),
	);

	it.live("lists a stored reading with its metric through RyotQL", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { metricId } = yield* createMeasurementReadingFixture(client);

			const result = yield* executeRyotQLRecipe(client, measurementReadingListRecipe({}));

			expect(result.items).toEqual([
				expect.objectContaining({
					metricId,
					unit: "kg",
					value: 75.5,
					comment: "Morning",
					metricKey: "weight",
					metricName: "Weight",
					occurredAt: expect.stringMatching(/^2026-04-27T08:00:00(\.\d+)?Z$/),
				}),
			]);
		}),
	);
});
