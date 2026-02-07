import { Schema as S } from "./effect";

const value = S.optionalWith(
	S.Array(S.String),
	{
		// Keep fresh array per decode.
		default: () => [],
	},
);

void value;
