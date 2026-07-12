import { Schema as S, SchemaTransformation as ST } from "effect";

const transformed = S.transform(S.String, S.Number, {
	encode: function(value) {
		return String(value);
	},
	strict: true,
	decode: function(value) {
		return Number(value);
	},
});

const composed = S.compose(S.Trim, S.String);
const shadowed = (S: any) => S.transform(S.String, S.Number, options);
