import { Schema } from "effect";

const key = Schema.String;
const value = Schema.Number;

const ordered = Schema.Record({ key: Schema.String, value: Schema.Number });
const shorthand = Schema.Record({ key, value });
const comments = Schema.Record({
	// key comment
	key: Schema.String,
	value: Schema.Number, // value comment
});
