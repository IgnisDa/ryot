import * as EffectPackage from "effect";
import { Schema } from "effect";

const value = Schema.String.pipe(
  schema => Schema.optional(schema).pipe(Schema.decodeTo(Schema.toType(schema), {
    decode: EffectPackage.SchemaGetter.withDefault(EffectPackage.Effect.sync(() => currentValue())),
    encode: EffectPackage.SchemaGetter.required()
  })),
  Schema.withConstructorDefault(EffectPackage.Effect.sync(() => currentValue()))
);

void value;
