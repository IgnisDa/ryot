import { Schema } from "@ryot-app/plugin-kit/effect";

import { IsoTimestamp, NonEmptyString, SubmissionEnvelope } from "./fitness-primitives";

export const measurementReadingLogOperationSlug = "measurement-reading-log";
export const measurementReadingUpdateOperationSlug = "measurement-reading-update";
export const measurementReadingDeleteOperationSlug = "measurement-reading-delete";

const MeasurementReadingIds = Schema.Array(NonEmptyString).pipe(
	Schema.check(Schema.isMinLength(1)),
);

export const MeasurementEntry = Schema.Struct({
	occurredAt: IsoTimestamp,
	comment: Schema.optional(Schema.Trim),
	values: Schema.Array(Schema.Struct({ value: Schema.Finite, metricId: NonEmptyString })).pipe(
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

export type MeasurementEntry = typeof MeasurementEntry.Type;

export const MeasurementReadingLogInput = Schema.Struct({
	...MeasurementEntry.fields,
	...SubmissionEnvelope.fields,
});

export type MeasurementReadingLogInput = typeof MeasurementReadingLogInput.Type;

export const MeasurementReadingUpdateInput = Schema.Struct({
	...MeasurementEntry.fields,
	readingIds: MeasurementReadingIds,
});

export const MeasurementReadingDeleteInput = Schema.Struct({ readingIds: MeasurementReadingIds });

export const MeasurementReadingOutput = Schema.Struct({ count: Schema.Int });

export const MeasurementReadingLogOutput = Schema.Struct({
	count: Schema.Int,
	status: Schema.Literals(["saved", "incomplete"]),
});
