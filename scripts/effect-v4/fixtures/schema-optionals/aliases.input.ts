import { Effect as Fx, Schema as S } from "@ryot/sandbox-sdk/effect";
import * as EffectPackage from "effect";

const sdk = S.optionalWith(S.String, { default: () => makeValue() });
const nested = S.optionalWith(S.Array(S.Number), { default: () => [] });

void [EffectPackage, sdk, nested];
