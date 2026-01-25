import { Schema as LocalSchema } from "./effect";

const value = LocalSchema.transform(LocalSchema.String, LocalSchema.Number, {
	strict: true,
	decode: (input) => Number(input),
	encode: (input) => String(input),
});
