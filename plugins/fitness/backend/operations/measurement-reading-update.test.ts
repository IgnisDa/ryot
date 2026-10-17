import { describe, expect, it } from "@effect/vitest";
import type { CreateEventsResponse } from "@ryot-app/contract/modules/events/schemas";
import { EventId } from "@ryot-app/contract/schema/brands";
import type { CreateEventItem, UpdateEventItem } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import {
	executeMeasurementRyotql,
	inMemoryRyotql,
	measurementTables,
} from "./in-memory-ryotql.test-support";
import updateDefinition, { manifest } from "./measurement-reading-update.sandbox";
import {
	MeasurementEntryNotFoundError,
	MeasurementMetricNotFoundError,
} from "./measurement-readings";

const execution = { metadata: {}, sandboxScriptId: "script-test" };
const occurredAt = "2026-04-28T07:30:00.000Z";

type Writes = {
	readonly deletes: (readonly string[])[];
	readonly updates: (readonly UpdateEventItem[])[];
	readonly creates: (readonly CreateEventItem[])[];
};

const recordingHost = (writes: Writes) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: executeMeasurementRyotql,
		updateUserEntity: ({ entityId }) => Effect.succeed({ entityId }),
		deleteEvents: (ids) =>
			Effect.sync(() => {
				writes.deletes.push(ids);
				return { count: ids.length };
			}),
		updateEvents: (items) =>
			Effect.sync(() => {
				writes.updates.push(items);
				return { count: items.length };
			}),
		createEvents: (items) =>
			Effect.sync(() => {
				writes.creates.push(items);
				return {
					count: items.length,
					outcomes: items.map((_, index): CreateEventsResponse["outcomes"][number] => ({
						index,
						status: "written",
						eventId: EventId.make(`created-event-${index}`),
					})),
				};
			}),
	});

const emptyWrites = (): Writes => ({ creates: [], deletes: [], updates: [] });

describe("measurement reading update operation", () => {
	it.live(
		"loads all 205 imported children before editing and keeps every host batch within 100",
		() =>
			Effect.gen(function* () {
				const metrics = Array.from({ length: 206 }, (_, index) => ({
					id: `metric-${index}`,
					entitySchemaPluginId: "fitness-owner",
					entitySchemaSlug: "measurement-metric",
				}));
				const children = metrics
					.slice(0, 205)
					.map(({ id }, index) => ({
						entityId: id,
						id: `child-${index}`,
						sessionEntityId: "entry-1",
						properties: { value: index },
						eventSchemaPluginId: "fitness-owner",
						eventSchemaSlug: "measurement-reading",
					}));
				const writes = emptyWrites();
				const entities: unknown[] = [];
				const host = defineSandboxTestHost(manifest, {
					executeRyotql: inMemoryRyotql({
						event: children,
						entity: [...(measurementTables.entity ?? []), ...metrics],
					}),
					deleteEvents: (ids) =>
						Effect.sync(() => {
							writes.deletes.push(ids);
							return { count: ids.length };
						}),
					updateUserEntity: (item) =>
						Effect.sync(() => {
							entities.push(item);
							return { entityId: item.entityId };
						}),
					updateEvents: (items) =>
						Effect.sync(() => {
							writes.updates.push(items);
							return { count: items.length };
						}),
					createEvents: (items) =>
						Effect.sync(() => {
							writes.creates.push(items);
							return {
								count: items.length,
								outcomes: items.map((_, index): CreateEventsResponse["outcomes"][number] => ({
									index,
									status: "written",
									eventId: EventId.make(`new-${index}`),
								})),
							};
						}),
				});
				const values = [...metrics.slice(0, 204), ...metrics.slice(205)].map(({ id }) => ({
					value: 0,
					metricId: id,
				}));
				expect(
					yield* runSandboxTestScript(
						updateDefinition,
						{ values, occurredAt, entryId: "entry-1", comment: "After run" },
						host,
						execution,
					),
				).toEqual({ count: 206 });
				expect(writes.updates.map((batch) => batch.length)).toEqual([100, 100, 4]);
				expect(writes.deletes).toEqual([["child-204"]]);
				expect(writes.creates).toEqual([
					[
						{
							occurredAt,
							entityId: "metric-205",
							properties: { value: 0 },
							sessionEntityId: "entry-1",
							eventSchemaSlug: "measurement-reading",
						},
					],
				]);
				expect(entities).toEqual([
					{
						entityId: "entry-1",
						name: "Measurement",
						properties: { occurredAt, comment: "After run" },
						expected: {
							name: "Measurement",
							updatedAt: "2026-04-27T08:00:00.000Z",
							properties: { occurredAt: "2026-04-27T08:00:00.000Z" },
						},
					},
				]);
			}),
	);

	it.live("updates kept values and time, removes cleared values, and adds new metrics", () =>
		Effect.gen(function* () {
			const writes = emptyWrites();

			expect(
				yield* runSandboxTestScript(
					updateDefinition,
					{
						occurredAt,
						comment: "Fasted",
						entryId: "entry-1",
						values: [{ value: 0, metricId: "weight" }],
					},
					recordingHost(writes),
					execution,
				),
			).toEqual({ count: 2 });
			expect(writes).toEqual({
				creates: [],
				deletes: [["reading-2"]],
				updates: [
					[
						{
							eventId: "reading-1",
							patch: { occurredAt, properties: { remove: [], set: { value: 0 } } },
						},
					],
				],
			});

			const added = emptyWrites();
			expect(
				yield* runSandboxTestScript(
					updateDefinition,
					{
						occurredAt,
						entryId: "entry-2",
						values: [
							{ value: 71, metricId: "weight" },
							{ value: 80, metricId: "waist" },
						],
					},
					recordingHost(added),
					execution,
				),
			).toEqual({ count: 2 });
			expect(added).toEqual({
				deletes: [],
				updates: [
					[
						{
							eventId: "reading-3",
							patch: { occurredAt, properties: { remove: [], set: { value: 71 } } },
						},
					],
				],
				creates: [
					[
						{
							occurredAt,
							entityId: "waist",
							properties: { value: 80 },
							sessionEntityId: "entry-2",
							eventSchemaSlug: "measurement-reading",
						},
					],
				],
			});
		}),
	);

	it.live("rejects foreign readings or metrics before writing anything", () =>
		Effect.gen(function* () {
			const writes = emptyWrites();
			const host = recordingHost(writes);

			const foreignReading = yield* Effect.flip(
				runSandboxTestScript(
					updateDefinition,
					{ occurredAt, entryId: "fake-reading", values: [{ value: 70, metricId: "weight" }] },
					host,
					execution,
				),
			);
			expect(foreignReading).toBeInstanceOf(MeasurementEntryNotFoundError);
			const foreignMetric = yield* Effect.flip(
				runSandboxTestScript(
					updateDefinition,
					{
						occurredAt,
						entryId: "entry-1",
						values: [
							{ value: 70, metricId: "weight" },
							{ value: 1, metricId: "exercise-1" },
						],
					},
					host,
					execution,
				),
			);
			expect(foreignMetric).toBeInstanceOf(MeasurementMetricNotFoundError);

			expect(writes).toEqual(emptyWrites());
		}),
	);

	it.live("writes no events when the entry compare-and-set fails", () =>
		Effect.gen(function* () {
			const writes = emptyWrites();
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: executeMeasurementRyotql,
				updateUserEntity: () => Effect.die("stale entry"),
				deleteEvents: (ids) => Effect.sync(() => ({ count: writes.deletes.push(ids) })),
				updateEvents: (items) => Effect.sync(() => ({ count: writes.updates.push(items) })),
				createEvents: (items) =>
					Effect.sync(() => ({ outcomes: [], count: writes.creates.push(items) })),
			});

			const exit = yield* Effect.exit(
				runSandboxTestScript(
					updateDefinition,
					{ occurredAt, entryId: "entry-1", values: [{ value: 0, metricId: "weight" }] },
					host,
					execution,
				),
			);

			expect(exit._tag).toBe("Failure");
			expect(writes).toEqual(emptyWrites());
		}),
	);
});
