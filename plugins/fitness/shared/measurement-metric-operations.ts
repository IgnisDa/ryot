import { Schema } from "@ryot-app/plugin-kit/effect";

import { measurementMetricKey, measurementMetricUnit } from "./measurement-metrics";

export const measurementMetricCreateOperationSlug = "measurement-metric-create";

export const MeasurementMetricCreateInput = Schema.Struct({
	unit: Schema.optional(Schema.Trim),
	name: Schema.Trim.pipe(
		Schema.check(
			Schema.makeFilter(
				(name) =>
					measurementMetricKey(name).length > 0 || "Name must produce a non-empty metric key",
			),
		),
	),
}).pipe(
	Schema.check(
		Schema.makeFilter(({ name, unit }) => {
			const canonical = measurementMetricUnit(measurementMetricKey(name));
			return canonical === undefined || !unit || unit === canonical || `Unit must be ${canonical}`;
		}),
	),
);

export type MeasurementMetricCreateInput = typeof MeasurementMetricCreateInput.Type;

export const MeasurementMetricCreateOutput = Schema.Struct({ entityId: Schema.String });
