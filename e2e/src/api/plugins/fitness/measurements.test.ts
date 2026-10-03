import { EntityId } from "@ryot-app/contract/schema/brands";
import { measurementSummaryRecipe } from "@ryot-app/fitness-plugin/measurement-recipes";
import { measurementReadingListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	findBuiltinPluginBySlug,
	getEntity,
	listEntitySchemas,
	listEventsForEntity,
	listEventSchemas,
	listSavedViews,
	requireEventSchemaBySlug,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import {
	createMeasurementMetric,
	createMeasurementReadingFixture,
	deleteMeasurementReadings,
} from "~/fixtures/plugins/fitness";
import { assertPresent, assertTaggedError, requirePresent } from "~/support/assertions";
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

	it.live("deletes a user's own readings and rejects another user's", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { client: otherClient } = yield* createAuthenticatedClient();
			yield* createMeasurementReadingFixture(client);
			const [stored] = (yield* executeRyotQLRecipe(client, measurementReadingListRecipe({}))).items;
			const readingIds = [requirePresent(stored, "Expected a reading").id];

			const failure = yield* Effect.flip(deleteMeasurementReadings(otherClient, { readingIds }));
			assertTaggedError(failure, "PluginInvocationError");
			expect(failure.reason).toMatchObject({
				code: "runtime-failed",
				diagnostics: [
					{ severity: "error", message: expect.stringContaining("Measurement reading not found") },
				],
			});
			expect(
				(yield* executeRyotQLRecipe(client, measurementReadingListRecipe({}))).items,
			).toHaveLength(1);

			expect(yield* deleteMeasurementReadings(client, { readingIds })).toEqual({ count: 1 });
			expect((yield* executeRyotQLRecipe(client, measurementReadingListRecipe({}))).items).toEqual(
				[],
			);
		}),
	);

	it.live("creates normalized metrics without readings and keeps their summaries private", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const [weight, custom, unitless] = yield* Effect.all([
				createMeasurementMetric(client, { name: " Weight " }),
				createMeasurementMetric(client, { unit: " points ", name: " Custom Metric " }),
				createMeasurementMetric(client, { name: "Resting Heart Rate" }),
			]);
			const metrics = [
				{ name: "Weight", entityId: weight.entityId, properties: { unit: "kg", key: "weight" } },
				{
					name: "Custom Metric",
					entityId: custom.entityId,
					properties: { unit: "points", key: "custom_metric" },
				},
				{
					name: "Resting Heart Rate",
					entityId: unitless.entityId,
					properties: { key: "resting_heart_rate" },
				},
			];

			for (const metric of metrics) {
				const stored = yield* getEntity(client, metric.entityId);
				expect(stored).toMatchObject({
					name: metric.name,
					id: metric.entityId,
					entitySchemaSlug: "measurement-metric",
				});
				expect(stored.properties).toEqual(metric.properties);
				expect(yield* listEventsForEntity(client, metric.entityId, undefined, 100)).toEqual([]);
			}

			const summary = yield* executeRyotQLRecipe(
				client,
				measurementSummaryRecipe({ rangeStart: "1970-01-01T00:00:00.000Z" }),
			);
			expect(summary.items).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						unit: "kg",
						key: "weight",
						firstAt: null,
						rangeCount: 0,
						latestAt: null,
						latestValue: null,
					}),
					expect.objectContaining({
						firstAt: null,
						rangeCount: 0,
						unit: "points",
						latestAt: null,
						latestValue: null,
						key: "custom_metric",
					}),
					expect.objectContaining({
						unit: null,
						firstAt: null,
						rangeCount: 0,
						latestAt: null,
						latestValue: null,
						key: "resting_heart_rate",
					}),
				]),
			);

			const { client: otherClient } = yield* createAuthenticatedClient();
			const otherSummary = yield* executeRyotQLRecipe(
				otherClient,
				measurementSummaryRecipe({ rangeStart: "1970-01-01T00:00:00.000Z" }),
			);
			expect(otherSummary.items).toEqual([]);
		}),
	);

	it.live("paginates all measurement metrics after the summary cursor", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: metricSchema } = yield* findBuiltinSchemaBySlug(client, "measurement-metric");
			const seeded = yield* Effect.all(
				Array.from({ length: 101 }, (_, index) => {
					const suffix = index.toString().padStart(3, "0");
					return createEntity(client, {
						name: `Metric ${suffix}`,
						entitySchemaSlug: metricSchema.id,
						properties: { key: `metric_${suffix}` },
					});
				}),
				{ concurrency: 4 },
			);

			const first = yield* executeRyotQLRecipe(
				client,
				measurementSummaryRecipe({ rangeStart: "1970-01-01T00:00:00.000Z" }),
			);
			expect(first.items).toHaveLength(100);
			expect(first.pageInfo.hasMore).toBe(true);
			const nextCursor = requirePresent(first.pageInfo.nextCursor, "Expected next metric cursor");

			const second = yield* executeRyotQLRecipe(
				client,
				measurementSummaryRecipe({ after: nextCursor, rangeStart: "1970-01-01T00:00:00.000Z" }),
			);
			expect(second.items).toHaveLength(1);
			expect(second.pageInfo.hasMore).toBe(false);
			const ids = [...first.items, ...second.items].map(({ id }) => id);
			expect(ids).toHaveLength(seeded.length);
			expect(new Set(ids)).toEqual(new Set(seeded.map(({ id }) => id)));
		}),
	);

	it.live("pages the reading log past 100 readings without repeating the boundary", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId } = yield* createMeasurementMetric(client, { name: "Weight" });
			const { schema } = yield* findBuiltinSchemaBySlug(client, "measurement-metric");
			const eventSchema = requireEventSchemaBySlug(
				yield* listEventSchemas(client, schema.id),
				"measurement-reading",
			);
			const readings = Array.from({ length: 101 }, (_, value) => ({
				properties: { value },
				eventSchemaSlug: eventSchema.id,
				entityId: EntityId.make(entityId),
				occurredAt: new Date(Date.UTC(2026, 0, 1, 0, value)).toISOString(),
			}));
			for (const payload of [readings.slice(0, 100), readings.slice(100)]) {
				yield* waitForCreateEvents(
					client,
					yield* client.call((contract) => contract.events.create({ payload })),
				);
			}
			const first = yield* executeRyotQLRecipe(
				client,
				measurementReadingListRecipe({ limit: 100 }),
			);
			expect(first.items.map(({ value }) => value)).toEqual(
				Array.from({ length: 100 }, (_, index) => 100 - index),
			);
			expect(first.pageInfo.hasMore).toBe(true);
			const second = yield* executeRyotQLRecipe(
				client,
				measurementReadingListRecipe({
					limit: 100,
					after: requirePresent(first.pageInfo.nextCursor, "Expected next reading cursor"),
				}),
			);
			expect(second.items.map(({ value }) => value)).toEqual([0]);
			expect(second.pageInfo.hasMore).toBe(false);
			expect(second.pageInfo.nextCursor).toBeNull();
			expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size).toBe(101);
		}),
	);
});
