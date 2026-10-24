import type { UpdateEventItem } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import { chunk } from "../../shared/collections";
import {
	measurementEntryProperties,
	measurementReadingProperties,
} from "../../shared/measurement-properties";
import {
	MEASUREMENT_EVENT_BATCH_SIZE,
	MeasurementReadingOutput,
	MeasurementReadingUpdateInput,
} from "../../shared/measurement-reading-operations";
import {
	readMeasurementEntryReadings,
	requireMeasurementEntry,
	requireMeasurementMetrics,
} from "./measurement-readings";

export const manifest = defineManifest({
	kind: "operation",
	name: "Update measurement readings",
	slug: "operation.measurement-reading-update",
});

export default defineOperation({
	manifest,
	output: MeasurementReadingOutput,
	input: MeasurementReadingUpdateInput,
	run: ({ values, comment, entryId, occurredAt }, host) =>
		Effect.gen(function* () {
			const entry = yield* requireMeasurementEntry(entryId, host.executeRyotql);
			const readings = yield* readMeasurementEntryReadings(entryId, host.executeRyotql);
			yield* requireMeasurementMetrics(
				values.map(({ metricId }) => metricId),
				host.executeRyotql,
			);
			const pending = new Map(values.map(({ value, metricId }) => [metricId, value]));
			const updates: UpdateEventItem[] = [];
			const removed: string[] = [];
			for (const { id, metricId } of readings) {
				const value = pending.get(metricId);
				if (value === undefined) {
					removed.push(id);
				} else {
					pending.delete(metricId);
					updates.push({
						eventId: id,
						patch: {
							occurredAt,
							properties: { remove: [], set: measurementReadingProperties(value) },
						},
					});
				}
			}
			yield* host.updateUserEntity({
				name: entry.name,
				entityId: entryId,
				properties: measurementEntryProperties(occurredAt, comment),
				expected: { name: entry.name, updatedAt: entry.updatedAt, properties: entry.properties },
			});
			let count = 0;
			for (const batch of chunk(updates, MEASUREMENT_EVENT_BATCH_SIZE)) {
				count += (yield* host.updateEvents(batch)).count;
			}
			for (const batch of chunk([...pending], MEASUREMENT_EVENT_BATCH_SIZE)) {
				const created = yield* host.createEvents(
					batch.map(([metricId, value]) => ({
						occurredAt,
						entityId: metricId,
						sessionEntityId: entryId,
						eventSchemaSlug: "measurement-reading",
						properties: measurementReadingProperties(value),
					})),
				);
				count += created.count;
			}
			for (const batch of chunk(removed, MEASUREMENT_EVENT_BATCH_SIZE)) {
				count += (yield* host.deleteEvents(batch)).count;
			}
			return { count };
		}),
});
