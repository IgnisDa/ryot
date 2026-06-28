import { Schema } from "effect";

const first = Schema.transform(Schema.String, Schema.Number, {
	strict: true,
	decode: (value) => Number(value),
	encode: (value) => String(value),
});

const second = Schema.compose(Schema.Trim, Schema.String);

const third = Schema.Trim.pipe(Schema.compose(Schema.String));
