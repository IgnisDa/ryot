import { Schema, SchemaTransformation } from "effect";

const SchemaTransformationRuntime = local;
const make = (SchemaTransformation: unknown) => Schema.transform(Schema.String, Schema.Number, {
	strict: true,
	decode: (value) => Number(value),
	encode: (value) => String(value),
});
