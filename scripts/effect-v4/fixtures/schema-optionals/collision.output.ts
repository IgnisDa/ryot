import { Schema, Effect as EffectRuntime, SchemaGetter } from "effect";

declare const Effect: { readonly local: true };

const value = Schema.String.pipe(
  schema => Schema.optional(schema).pipe(Schema.decodeTo(Schema.toType(schema), {
    decode: SchemaGetter.withDefault(EffectRuntime.sync(() => currentValue())),
    encode: SchemaGetter.required()
  })),
  Schema.withConstructorDefault(EffectRuntime.sync(() => currentValue()))
);

void [Effect, value];
