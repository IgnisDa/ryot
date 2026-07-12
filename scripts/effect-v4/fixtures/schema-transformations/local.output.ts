import { Schema as LocalSchema, SchemaTransformation } from "./effect";

const value = LocalSchema.String.pipe(LocalSchema.decodeTo(LocalSchema.Number, SchemaTransformation.transform({
    decode: (input) => Number(input),
    encode: (input) => String(input)
})));
