import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

import {
	MeasurementMetricCreateInput,
	MeasurementMetricCreateOutput,
} from "../../shared/measurement-metric-operations";
import { measurementMetricKey, measurementMetricUnit } from "../../shared/measurement-metrics";

export const manifest = defineManifest({
	kind: "operation",
	name: "Create measurement metric",
	slug: "operation.measurement-metric-create",
});

export default defineOperation({
	manifest,
	input: MeasurementMetricCreateInput,
	output: MeasurementMetricCreateOutput,
	run: ({ name, unit }, host) => {
		const key = measurementMetricKey(name);
		const storedUnit = measurementMetricUnit(key) ?? unit;
		return host.createUserEntity({
			name,
			entitySchemaSlug: "measurement-metric",
			properties: { key, ...(storedUnit ? { unit: storedUnit } : {}) },
		});
	},
});
