import { DateTime, Schema, SchemaGetter } from "effect";

export const IsoDateString = Schema.DateTimeUtcFromString.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform(DateTime.formatIso),
		encode: SchemaGetter.transform(DateTime.makeUnsafe),
	}),
);
