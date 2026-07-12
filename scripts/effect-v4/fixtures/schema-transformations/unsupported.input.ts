import { Schema } from "effect";

const valid = Schema.compose(from, to);
const invalid = Schema.transform(from, to, {
	strict: false,
	decode: (value) => value,
	encode: (value) => value,
});
