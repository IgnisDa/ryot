import { createEventChange, existingEntity, rootEntity } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	measurementEntryEntity,
	measurementReadingProperties,
} from "../../shared/measurement-properties";
import {
	MeasurementReadingLogInput,
	MeasurementReadingLogOutput,
} from "../../shared/measurement-reading-operations";
import { requireMeasurementMetrics } from "./measurement-readings";

export const manifest = defineManifest({
	kind: "operation",
	name: "Log measurement readings",
	slug: "operation.measurement-reading-log",
});

export default defineOperation({
	manifest,
	input: MeasurementReadingLogInput,
	output: MeasurementReadingLogOutput,
	run: ({ values, comment, occurredAt }, host) =>
		Effect.gen(function* () {
			yield* requireMeasurementMetrics(
				values.map(({ metricId }) => metricId),
				host.executeRyotql,
			);
			return {
				output: { count: values.length },
				changes: {
					entity: { ...measurementEntryEntity(occurredAt, comment), target: { kind: "create" } },
					events: {
						changes: values.map(({ value, metricId }) =>
							createEventChange(`reading:${metricId}`, {
								occurredAt,
								session: rootEntity,
								eventSchemaSlug: "measurement-reading",
								entity: existingEntity(EntityId.make(metricId)),
								properties: measurementReadingProperties(value),
							}),
						),
					},
				},
			};
		}),
});
