import { describe, expect, it } from "@effect/vitest";
import { EventId } from "@ryot-app/contract/schema/brands";
import type { CreateEventItem, UpdateEventItem } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import updateDefinition, { manifest } from "./measurement-reading-update.sandbox";
import {
	MeasurementMetricNotFoundError,
	MeasurementReadingNotFoundError,
} from "./measurement-readings";
import { executeMeasurementRyotql } from "./measurement-readings.test-support";

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
					outcomes: items.map((_, index) => ({
						index,
						status: "written" as const,
						eventId: EventId.make(`created-event-${index}`),
					})),
				};
			}),
	});

const emptyWrites = (): Writes => ({ creates: [], deletes: [], updates: [] });

describe("measurement reading update operation", () => {
	it.live("updates kept values and time, removes cleared values, and adds new metrics", () =>
		Effect.gen(function* () {
			const writes = emptyWrites();

			expect(
				yield* runSandboxTestScript(
					updateDefinition,
					{
						occurredAt,
						comment: "Fasted",
						readingIds: ["reading-1", "reading-2"],
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
							patch: {
								occurredAt,
								properties: { remove: [], set: { value: 0, comment: "Fasted" } },
							},
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
						readingIds: ["reading-1"],
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
							eventId: "reading-1",
							patch: { occurredAt, properties: { set: { value: 71 }, remove: ["comment"] } },
						},
					],
				],
				creates: [
					[
						{
							occurredAt,
							entityId: "waist",
							properties: { value: 80 },
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
					{
						occurredAt,
						readingIds: ["reading-1", "fake-reading"],
						values: [{ value: 70, metricId: "weight" }],
					},
					host,
					execution,
				),
			);
			expect(foreignReading).toBeInstanceOf(MeasurementReadingNotFoundError);
			const foreignMetric = yield* Effect.flip(
				runSandboxTestScript(
					updateDefinition,
					{
						occurredAt,
						readingIds: ["reading-1"],
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
});
