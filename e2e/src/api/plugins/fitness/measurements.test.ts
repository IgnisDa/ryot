import { builtinSavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { measurementSummaryRecipe } from "@ryot-app/fitness-plugin/measurement-recipes";
import { measurementReadingListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	executeRyotQLRecipe,
	getEntity,
	listEventSchemas,
	listEventsForEntity,
	listSavedViews,
	requireEventSchemaBySlug,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	createMeasurementMetric,
	createMeasurementReadingFixture,
	deleteMeasurementReadings,
	findFitnessEntitySchema,
	logMeasurementReadings,
	pinMeasurementMetric,
	updateMeasurementReadings,
} from "~/fixtures/plugins/fitness";
import { assertPresent, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const fitnessReference = (client: Client) =>
	findFitnessEntitySchema(client, "measurement-metric").pipe(
		Effect.map(({ pluginId }) => ({ pluginId, kind: "local" as const })),
	);

describe("Measurements E2E", () => {
	it.live(
		"retries lost-response and concurrent submissions without duplicates and rejects changed content",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const reference = yield* fitnessReference(client);
				const weight = yield* createMeasurementMetric(client, { name: "Weight" });
				const waist = yield* createMeasurementMetric(client, { name: "Waist" });
				const input = {
					comment: "Fasted",
					submissionId: crypto.randomUUID(),
					occurredAt: "2026-10-01T07:30:00.000Z",
					submittedAt: "2026-10-15T08:00:00.000Z",
					values: [
						{ value: 0, metricId: weight.entityId },
						{ value: 80.5, metricId: waist.entityId },
					],
				};
				yield* logMeasurementReadings(client, input);
				const original = yield* executeRyotQLRecipe(
					client,
					measurementReadingListRecipe({ reference }),
				);
				expect(original.items).toHaveLength(2);
				const retries = yield* Effect.all(
					[logMeasurementReadings(client, input), logMeasurementReadings(client, input)],
					{ concurrency: "unbounded" },
				);
				expect(retries).toEqual([
					{ count: 2, status: "saved" },
					{ count: 2, status: "saved" },
				]);
				expect(
					(yield* executeRyotQLRecipe(client, measurementReadingListRecipe({ reference }))).items,
				).toEqual(original.items);
				const conflict = yield* Effect.flip(
					logMeasurementReadings(client, { ...input, comment: "Changed" }),
				);
				assertTaggedError(conflict, "PluginInvocationError");
				expect(conflict.reason.code).toBe("runtime-failed");
				expect(
					(yield* executeRyotQLRecipe(client, measurementReadingListRecipe({ reference }))).items,
				).toEqual(original.items);
				const concurrent = { ...input, submissionId: crypto.randomUUID() };
				expect(
					yield* Effect.all(
						[
							logMeasurementReadings(client, concurrent),
							logMeasurementReadings(client, concurrent),
						],
						{ concurrency: "unbounded" },
					),
				).toEqual([
					{ count: 2, status: "saved" },
					{ count: 2, status: "saved" },
				]);
				expect(
					(yield* executeRyotQLRecipe(client, measurementReadingListRecipe({ reference }))).items,
				).toHaveLength(4);
				const { client: other } = yield* createAuthenticatedClient();
				const otherMetric = yield* createMeasurementMetric(other, { name: "Weight" });
				expect(
					yield* logMeasurementReadings(other, {
						...input,
						values: [{ value: 0, metricId: otherMetric.entityId }],
					}),
				).toEqual({ count: 1, status: "saved" });
			}),
	);

	it.live("links the built-in metric schema to the fitness plugin and drops the old schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId, schema: metricSchema } = yield* findFitnessEntitySchema(
				client,
				"measurement-metric",
			);

			expect(metricSchema.name).toBe("Measurement Metric");
			expect(metricSchema.isBuiltin).toBe(true);
			expect(metricSchema.pluginId).toBe(pluginId);
		}),
	);

	it.live("exposes the metric and reading schema properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: metricSchema } = yield* findFitnessEntitySchema(client, "measurement-metric");
			const readingSchema = requireEventSchemaBySlug(
				yield* listEventSchemas(client, metricSchema.reference),
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
				const { pluginId } = yield* findFitnessEntitySchema(client, "measurement-metric");
				const views = yield* listSavedViews(client, { pluginId });
				const allMeasurementsView = views.find((view) => view.name === "All Measurements");
				assertPresent(allMeasurementsView, "Expected the built-in All Measurements saved view");

				expect(allMeasurementsView).toMatchObject({
					settings: {},
					isBuiltin: true,
					dataSources: null,
					name: "All Measurements",
					renderer: { kind: "plugin", exportName: "measurements" },
					reference: builtinSavedViewReference(pluginId, "all-measurements"),
				});
			}),
	);

	it.live("lists a stored reading with its metric through RyotQL", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findFitnessEntitySchema(client, "measurement-metric");
			const { metricId } = yield* createMeasurementReadingFixture(client);

			const result = yield* executeRyotQLRecipe(
				client,
				measurementReadingListRecipe({ reference: { pluginId, kind: "local" } }),
			);

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
			const reference = yield* fitnessReference(client);
			const { client: otherClient } = yield* createAuthenticatedClient();
			yield* createMeasurementReadingFixture(client);
			const [stored] = (yield* executeRyotQLRecipe(
				client,
				measurementReadingListRecipe({ reference }),
			)).items;
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
				(yield* executeRyotQLRecipe(client, measurementReadingListRecipe({ reference }))).items,
			).toHaveLength(1);

			expect(yield* deleteMeasurementReadings(client, { readingIds })).toEqual({ count: 1 });
			expect(
				(yield* executeRyotQLRecipe(client, measurementReadingListRecipe({ reference }))).items,
			).toEqual([]);
		}),
	);

	it.live("logs readings at one time and edits, adds, and clears them in place", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const reference = yield* fitnessReference(client);
			const { client: otherClient } = yield* createAuthenticatedClient();
			const weight = yield* createMeasurementMetric(client, { name: "Weight" });
			const waist = yield* createMeasurementMetric(client, { name: "Waist" });
			const hip = yield* createMeasurementMetric(client, { name: "Hip" });
			const listReadings = () =>
				executeRyotQLRecipe(client, measurementReadingListRecipe({ reference })).pipe(
					Effect.map(({ items }) =>
						items.map(({ value, comment, metricKey, occurredAt }) => ({
							value,
							comment,
							metricKey,
							occurredAt: new Date(occurredAt).toISOString(),
						})),
					),
				);
			const logged = {
				comment: " Morning ",
				occurredAt: "2026-04-27T08:00:00.000Z",
				values: [
					{ value: 0, metricId: weight.entityId },
					{ value: 80, metricId: waist.entityId },
				],
			};

			const foreignLog = yield* Effect.flip(logMeasurementReadings(otherClient, logged));
			assertTaggedError(foreignLog, "PluginInvocationError");
			expect(foreignLog.reason).toMatchObject({
				diagnostics: [{ message: expect.stringContaining("Measurement metric not found") }],
			});
			expect(yield* logMeasurementReadings(client, logged)).toEqual({ count: 2, status: "saved" });
			expect(yield* listReadings()).toEqual([
				{
					value: 80,
					metricKey: "waist",
					comment: "Morning",
					occurredAt: "2026-04-27T08:00:00.000Z",
				},
				{
					value: 0,
					comment: "Morning",
					metricKey: "weight",
					occurredAt: "2026-04-27T08:00:00.000Z",
				},
			]);

			const readingIds = (yield* executeRyotQLRecipe(
				client,
				measurementReadingListRecipe({ reference }),
			)).items.map(({ id }) => id);
			const edited = {
				readingIds,
				occurredAt: "2026-04-28T09:15:00.000Z",
				values: [
					{ value: 71.2, metricId: weight.entityId },
					{ value: 95, metricId: hip.entityId },
				],
			};
			const foreignEdit = yield* Effect.flip(updateMeasurementReadings(otherClient, edited));
			assertTaggedError(foreignEdit, "PluginInvocationError");
			expect(foreignEdit.reason).toMatchObject({
				diagnostics: [{ message: expect.stringContaining("Measurement reading not found") }],
			});
			expect(yield* updateMeasurementReadings(client, edited)).toEqual({ count: 3 });
			expect(yield* listReadings()).toEqual([
				{ value: 95, comment: null, metricKey: "hip", occurredAt: "2026-04-28T09:15:00.000Z" },
				{ value: 71.2, comment: null, metricKey: "weight", occurredAt: "2026-04-28T09:15:00.000Z" },
			]);
		}),
	);

	it.live("creates normalized metrics without readings and keeps their summaries private", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const reference = yield* fitnessReference(client);
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
				measurementSummaryRecipe({ reference, rangeStart: "1970-01-01T00:00:00.000Z" }),
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
				measurementSummaryRecipe({ reference, rangeStart: "1970-01-01T00:00:00.000Z" }),
			);
			expect(otherSummary.items).toEqual([]);
		}),
	);

	it.live("auto-pins the first two created metrics and limits pins to three", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const reference = yield* fitnessReference(client);
			const { client: otherClient } = yield* createAuthenticatedClient();
			const weight = yield* createMeasurementMetric(client, { name: "Weight" });
			const waist = yield* createMeasurementMetric(client, { name: "Waist" });
			const hip = yield* createMeasurementMetric(client, { name: "Hip" });
			const bmi = yield* createMeasurementMetric(client, { name: "BMI" });
			const pinnedIds = () =>
				executeRyotQLRecipe(
					client,
					measurementSummaryRecipe({ reference, rangeStart: "1970-01-01T00:00:00.000Z" }),
				).pipe(
					Effect.map(({ items }) =>
						items
							.flatMap(({ id, pinnedAt }) => (pinnedAt === null ? [] : [{ id, pinnedAt }]))
							.sort((left, right) => Date.parse(left.pinnedAt) - Date.parse(right.pinnedAt))
							.map(({ id }) => id),
					),
				);

			expect(yield* pinnedIds()).toEqual([weight.entityId, waist.entityId]);

			expect(yield* pinMeasurementMetric(client, { pinned: true, metricId: hip.entityId })).toEqual(
				{ pinned: true },
			);
			expect(yield* pinnedIds()).toEqual([weight.entityId, waist.entityId, hip.entityId]);

			const limited = yield* Effect.flip(
				pinMeasurementMetric(client, { pinned: true, metricId: bmi.entityId }),
			);
			assertTaggedError(limited, "PluginInvocationError");
			expect(limited.reason).toMatchObject({ code: "runtime-failed" });
			expect(yield* pinnedIds()).toEqual([weight.entityId, waist.entityId, hip.entityId]);

			const foreign = yield* Effect.flip(
				pinMeasurementMetric(otherClient, { pinned: true, metricId: bmi.entityId }),
			);
			assertTaggedError(foreign, "PluginInvocationError");

			expect(
				yield* pinMeasurementMetric(client, { pinned: false, metricId: weight.entityId }),
			).toEqual({ pinned: false });
			expect(yield* pinMeasurementMetric(client, { pinned: true, metricId: bmi.entityId })).toEqual(
				{ pinned: true },
			);
			expect(yield* pinnedIds()).toEqual([waist.entityId, hip.entityId, bmi.entityId]);
		}),
	);

	it.live("paginates all measurement metrics after the summary cursor", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const reference = yield* fitnessReference(client);
			const { schema: metricSchema } = yield* findFitnessEntitySchema(client, "measurement-metric");
			const seeded = yield* Effect.all(
				Array.from({ length: 101 }, (_, index) => {
					const suffix = index.toString().padStart(3, "0");
					return createEntity(client, {
						name: `Metric ${suffix}`,
						entitySchema: metricSchema.reference,
						properties: { key: `metric_${suffix}` },
					});
				}),
				{ concurrency: 4 },
			);

			const first = yield* executeRyotQLRecipe(
				client,
				measurementSummaryRecipe({ reference, rangeStart: "1970-01-01T00:00:00.000Z" }),
			);
			expect(first.items).toHaveLength(100);
			expect(first.pageInfo.hasMore).toBe(true);
			const nextCursor = requirePresent(first.pageInfo.nextCursor, "Expected next metric cursor");

			const second = yield* executeRyotQLRecipe(
				client,
				measurementSummaryRecipe({
					reference,
					after: nextCursor,
					rangeStart: "1970-01-01T00:00:00.000Z",
				}),
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
			const reference = yield* fitnessReference(client);
			const { entityId } = yield* createMeasurementMetric(client, { name: "Weight" });
			const { schema } = yield* findFitnessEntitySchema(client, "measurement-metric");
			const eventSchema = requireEventSchemaBySlug(
				yield* listEventSchemas(client, schema.reference),
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
				measurementReadingListRecipe({ reference, limit: 100 }),
			);
			expect(first.items.map(({ value }) => value)).toEqual(
				Array.from({ length: 100 }, (_, index) => 100 - index),
			);
			expect(first.pageInfo.hasMore).toBe(true);
			const second = yield* executeRyotQLRecipe(
				client,
				measurementReadingListRecipe({
					reference,
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
