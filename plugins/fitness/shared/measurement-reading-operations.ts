import { Schema } from "@ryot-app/plugin-kit/effect";

export const measurementReadingDeleteOperationSlug = "measurement-reading-delete";

export const MeasurementReadingDeleteInput = Schema.Struct({
	readingIds: Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1)))).pipe(
		Schema.check(Schema.isMinLength(1)),
	),
});

export type MeasurementReadingDeleteInput = typeof MeasurementReadingDeleteInput.Type;

export const MeasurementReadingDeleteOutput = Schema.Struct({ count: Schema.Int });
