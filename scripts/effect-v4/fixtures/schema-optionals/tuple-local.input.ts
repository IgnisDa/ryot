import { Schema as S } from "./effect";

const value = S.Tuple([S.String, S.optionalElement(S.Number)]);

void value;
