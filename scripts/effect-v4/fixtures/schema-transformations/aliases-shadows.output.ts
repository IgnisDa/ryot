import { Schema as S, SchemaTransformation as ST } from "effect";

const transformed = S.String.pipe(S.decodeTo(S.Number, ST.transform({
    decode: function(value) {
		return Number(value);
	},

    encode: function(value) {
		return String(value);
	}
})));

const composed = S.Trim.pipe(S.decodeTo(S.String));
const shadowed = (S: any) => S.transform(S.String, S.Number, options);
