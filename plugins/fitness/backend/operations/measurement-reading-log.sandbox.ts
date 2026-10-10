import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	MeasurementReadingLogInput,
	MeasurementReadingOutput,
	measurementReadingProperties,
} from "../../shared/measurement-reading-operations";
import { requireMeasurementMetrics } from "./measurement-readings";

export const manifest = defineManifest({
	kind: "operation",
	name: "Log measurement readings",
	slug: "operation.measurement-reading-log",
});

export default defineOperation({
	manifest,
	output: MeasurementReadingOutput,
	input: MeasurementReadingLogInput,
	run: ({ values, comment, occurredAt }, host) =>
		Effect.gen(function* () {
			yield* requireMeasurementMetrics(
				values.map(({ metricId }) => metricId),
				host.executeRyotql,
			);
			return yield* host.createEvents(
				values.map(({ value, metricId }) => ({
					occurredAt,
					entityId: metricId,
					eventSchemaSlug: "measurement-reading",
					properties: measurementReadingProperties(value, comment),
				})),
			);
		}),
});
