import { Schema } from "effect";

const valid = Schema.String.pipe(Schema.minLength(1));
const unsupported = Schema.int<typeof Schema.Number>();
