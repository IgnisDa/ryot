import { Schema } from "effect";

function isEmail(value: string): true | string {
	return value.includes("@") || "invalid email";
}

function isNonEmpty(value: string) {
	return value.length > 0;
}

const hasBounds = (value: { min: number; max: number }) => value.min <= value.max;

const booleanResult = Schema.String.pipe(Schema.filter((value) => value.length > 0));
const outputResult = Schema.String.pipe(Schema.filter((value) => true || "invalid"));
const namedFunction = Schema.String.pipe(Schema.filter(isEmail));
const inferredFunction = Schema.String.pipe(Schema.filter(isNonEmpty));
const namedConst = Schema.Struct({ min: Schema.Number, max: Schema.Number }).pipe(
	Schema.filter(hasBounds, {
		identifier: "bounds",
		// Keep message position and comments.
		message: () => getBoundsMessage(),
	}),
);
const functionResult = Schema.String.pipe(
	Schema.filter(function (value) {
		return value.length > 1 || "too short";
	}, { message: "length" }),
);
