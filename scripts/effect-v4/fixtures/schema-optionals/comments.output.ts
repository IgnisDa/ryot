import { Schema as S, Effect, SchemaGetter } from "./effect";

const value = S.Array(S.String).pipe(schema => S.optional(schema).pipe(S.decodeTo(S.toType(schema), {
    decode: SchemaGetter.withDefault(// Keep fresh array per decode.
    Effect.sync(() => [])),

    encode: SchemaGetter.required()
})), S.withConstructorDefault(Effect.sync(() => [])));

void value;
