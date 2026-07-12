import { Schema } from "effect";

declare const Effect: { readonly local: true };

const value = Schema.optionalWith(Schema.String, { default: () => currentValue() });

void [Effect, value];
