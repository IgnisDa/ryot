import { Schema } from "@ryot-app/plugin-kit/effect";

import { measurementMetricKey, measurementMetricUnit } from "./measurement-metrics";

export const measurementMetricCreateOperationSlug = "measurement-metric-create";
export const measurementMetricPinOperationSlug = "measurement-metric-pin";

export const MEASUREMENT_PIN_LIMIT = 3;

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

export const MeasurementMetricPinInput = Schema.Struct({
	pinned: Schema.Boolean,
	metricId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
});

export type MeasurementMetricPinInput = typeof MeasurementMetricPinInput.Type;

export const MeasurementMetricPinOutput = Schema.Struct({ pinned: Schema.Boolean });
