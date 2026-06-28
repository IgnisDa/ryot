import { Effect as Fx, Schema as S } from "@ryot/sandbox-sdk/effect";
import * as EffectPackage from "effect";

const sdk = S.String.pipe(schema => S.optional(schema).pipe(S.decodeTo(S.toType(schema), {
  decode: EffectPackage.SchemaGetter.withDefault(Fx.sync(() => makeValue())),
  encode: EffectPackage.SchemaGetter.required()
})), S.withConstructorDefault(Fx.sync(() => makeValue())));
const nested = S.Array(S.Number).pipe(schema => S.optional(schema).pipe(S.decodeTo(S.toType(schema), {
  decode: EffectPackage.SchemaGetter.withDefault(Fx.sync(() => [])),
  encode: EffectPackage.SchemaGetter.required()
})), S.withConstructorDefault(Fx.sync(() => [])));

void [EffectPackage, sdk, nested];
