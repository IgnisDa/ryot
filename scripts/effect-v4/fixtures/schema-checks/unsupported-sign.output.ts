import { Schema } from "effect";

const supported = Schema.Number.pipe(Schema.positive());
const negative = Schema.Number.pipe(Schema.negative({ message: () => "negative" }));
const nonPositive = Schema.Number.pipe(Schema.nonPositive());
