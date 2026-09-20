import { Schema } from "@ryot-app/plugin-kit/effect";

export const measurementReadingLogOperationSlug = "measurement-reading-log";
export const measurementReadingUpdateOperationSlug = "measurement-reading-update";
export const measurementReadingDeleteOperationSlug = "measurement-reading-delete";

const MeasurementId = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

const MeasurementReadingIds = Schema.Array(MeasurementId).pipe(Schema.check(Schema.isMinLength(1)));

const MeasurementEntry = Schema.Struct({
	comment: Schema.optional(Schema.Trim),
	occurredAt: Schema.String.pipe(
		Schema.check(
			Schema.makeFilter(
				(occurredAt) => !Number.isNaN(Date.parse(occurredAt)) || "Expected a valid timestamp",
			),
		),
	),
	values: Schema.Array(Schema.Struct({ value: Schema.Finite, metricId: MeasurementId })).pipe(
		Schema.check(Schema.isMinLength(1)),
		Schema.check(Schema.isMaxLength(100)),
		Schema.check(
			Schema.makeFilter(
				(values) =>
					new Set(values.map(({ metricId }) => metricId)).size === values.length ||
					"Each metric can be recorded once",
			),
		),
	),
});

export const MeasurementReadingLogInput = MeasurementEntry;

export type MeasurementReadingLogInput = typeof MeasurementReadingLogInput.Type;

export const MeasurementReadingUpdateInput = Schema.Struct({
	...MeasurementEntry.fields,
	readingIds: MeasurementReadingIds,
});

export const MeasurementReadingDeleteInput = Schema.Struct({ readingIds: MeasurementReadingIds });

export const MeasurementReadingOutput = Schema.Struct({ count: Schema.Int });

export const measurementReadingProperties = (
	value: number,
	comment: string | null | undefined,
) => ({ value, ...(comment ? { comment } : {}) });
