import { Schema, SchemaTransformation } from "effect";

const first = Schema.String.pipe(Schema.decodeTo(Schema.Number, SchemaTransformation.transform({
    decode: (value) => Number(value),
    encode: (value) => String(value)
})));

const second = Schema.Trim.pipe(Schema.decodeTo(Schema.String));

const third = Schema.Trim.pipe(Schema.decodeTo(Schema.String));
