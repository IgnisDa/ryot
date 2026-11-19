import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

const timezoneUploadTokenInput = <const Source extends string>(source: Source) =>
	strictStruct({
		timezone: TimeZone,
		source: Schema.Literal(source),
		uploadToken: Schema.NonEmptyString,
	}).pipe(Schema.annotate({ identifier: `FitnessImportInput_${source}` }));

export const FitnessCreateImportRunBody = Schema.Union([
	timezoneUploadTokenInput("open_scale"),
	timezoneUploadTokenInput("hevy"),
	timezoneUploadTokenInput("strong_app"),
]);

export type FitnessCreateImportRunBody = typeof FitnessCreateImportRunBody.Type;
