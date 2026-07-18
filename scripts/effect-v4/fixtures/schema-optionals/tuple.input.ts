import { Schema as S } from "effect";

const direct = S.Tuple([S.String, S.optionalElement(S.NumberFromString)]);
const single = S.Tuple([S.optionalElement(S.Boolean)]);

void [direct, single];
