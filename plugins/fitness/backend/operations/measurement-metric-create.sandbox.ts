import { rootEntity } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	MeasurementMetricCreateInput,
	MeasurementMetricCreateOutput,
} from "../../shared/measurement-metric-operations";
import { measurementMetricKey, measurementMetricUnit } from "../../shared/measurement-metrics";
import { measurementMetricProperties } from "../../shared/measurement-properties";
import { measurementMetricIds, measurementMetricPinChanges } from "./measurement-pins";

const AUTO_PINNED_METRICS = 2;

export const manifest = defineManifest({
	kind: "operation",
	name: "Create measurement metric",
	slug: "operation.measurement-metric-create",
});

export default defineOperation({
	manifest,
	input: MeasurementMetricCreateInput,
	output: MeasurementMetricCreateOutput,
	run: ({ name, unit }, host) =>
		Effect.gen(function* () {
			const key = measurementMetricKey(name);
			const storedUnit = measurementMetricUnit(key) ?? unit;
			const existing = yield* measurementMetricIds(AUTO_PINNED_METRICS, host.executeRyotql);
			const pin =
				existing.length < AUTO_PINNED_METRICS
					? yield* measurementMetricPinChanges(
							{ pinned: true, metric: rootEntity },
							host.executeRyotql,
						)
					: undefined;
			return {
				output: {},
				changes: {
					...pin,
					entity: {
						name,
						target: { kind: "create" },
						entitySchemaSlug: "measurement-metric",
						properties: measurementMetricProperties(key, storedUnit),
					},
				},
			};
		}),
});
