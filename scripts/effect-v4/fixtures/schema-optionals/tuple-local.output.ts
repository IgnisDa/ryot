import { Schema as S } from "./effect";

const value = S.Tuple([S.String, S.optionalKey(S.Number)]);

void value;
