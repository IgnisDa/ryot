import { Schema } from "effect";

const valid = Schema.optionalWith(Schema.String, { default: () => "" });
const unsupported = Schema.optionalWith(Schema.String, { exact: true, default: () => "" });

void [valid, unsupported];
