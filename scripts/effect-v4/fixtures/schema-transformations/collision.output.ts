import {
    Schema,
    SchemaTransformation,
    SchemaTransformation as SchemaTransformation2,
} from "effect";

const SchemaTransformationRuntime = local;
const make = (SchemaTransformation: unknown) => Schema.String.pipe(Schema.decodeTo(Schema.Number, SchemaTransformation2.transform({
    decode: (value) => Number(value),
    encode: (value) => String(value)
})));
