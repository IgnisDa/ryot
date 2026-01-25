import { Schema as S } from "effect";

const direct = S.Tuple([S.String, S.optionalKey(S.NumberFromString)]);
const single = S.Tuple([S.optionalKey(S.Boolean)]);

void [direct, single];
