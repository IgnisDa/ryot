import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

import {
	MeasurementMetricCreateInput,
	MeasurementMetricCreateOutput,
} from "../../shared/measurement-metric-operations";
import { measurementMetricKey, measurementMetricUnit } from "../../shared/measurement-metrics";
import { changeMeasurementMetricPin, measurementMetricIds } from "./measurement-pins";

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
			const created = yield* host.createUserEntity({
				name,
				entitySchemaSlug: "measurement-metric",
				properties: { key, ...(storedUnit ? { unit: storedUnit } : {}) },
			});
			if (existing.length < AUTO_PINNED_METRICS) {
				yield* changeMeasurementMetricPin({ pinned: true, metricId: created.entityId }, host);
			}
			return created;
		}),
});
