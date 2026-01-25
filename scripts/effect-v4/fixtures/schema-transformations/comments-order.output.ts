import { Schema, SchemaTransformation } from "effect";

const transformed = makeFrom().pipe(Schema.decodeTo(makeTo(), SchemaTransformation.transform(/* options */ {
    /* strict marker */ decode: /* decode callback */ (value) => decodeValue(value),
    encode: /* encode callback */ (value) => encodeValue(value)
})));
