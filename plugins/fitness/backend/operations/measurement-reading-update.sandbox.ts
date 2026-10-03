import type { UpdateEventItem } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

import {
	MeasurementReadingOutput,
	MeasurementReadingUpdateInput,
	measurementReadingProperties,
} from "../../shared/measurement-reading-operations";
import { requireMeasurementMetrics, requireMeasurementReadings } from "./measurement-readings";

export const manifest = defineManifest({
	kind: "operation",
	name: "Update measurement readings",
	slug: "operation.measurement-reading-update",
});

export default defineOperation({
	manifest,
	output: MeasurementReadingOutput,
	input: MeasurementReadingUpdateInput,
	run: ({ values, comment, readingIds, occurredAt }, host) =>
		Effect.gen(function* () {
			const readings = yield* requireMeasurementReadings(readingIds, host.executeRyotql);
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
							properties: {
								remove: comment ? [] : ["comment"],
								set: measurementReadingProperties(value, comment),
							},
						},
					});
				}
			}
			yield* requireMeasurementMetrics([...pending.keys()], host.executeRyotql);
			let count = 0;
			if (updates.length > 0) {
				count += (yield* host.updateEvents(updates)).count;
			}
			if (pending.size > 0) {
				const created = yield* host.createEvents(
					[...pending].map(([metricId, value]) => ({
						occurredAt,
						entityId: metricId,
						eventSchemaSlug: "measurement-reading",
						properties: measurementReadingProperties(value, comment),
					})),
				);
				count += created.count;
			}
			if (removed.length > 0) {
				count += (yield* host.deleteEvents(removed)).count;
			}
			return { count };
		}),
});
