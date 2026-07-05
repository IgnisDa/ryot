import { Schema } from "effect";

function isEmail(value: string): true | string {
	return value.includes("@") || "invalid email";
}

function isNonEmpty(value: string) {
	return value.length > 0;
}

const hasBounds = (value: { min: number; max: number }) => value.min <= value.max;

const booleanResult = Schema.String.pipe(Schema.check(Schema.makeFilter((value) => value.length > 0)));
const outputResult = Schema.String.pipe(Schema.check(Schema.makeFilter((value) => true || "invalid")));
const namedFunction = Schema.String.pipe(Schema.check(Schema.makeFilter(isEmail)));
const inferredFunction = Schema.String.pipe(Schema.check(Schema.makeFilter(isNonEmpty)));
const namedConst = Schema.Struct({ min: Schema.Number, max: Schema.Number }).pipe(
	Schema.check(Schema.makeFilter(schemaFilterInput => {
        const schemaFilterOutput = hasBounds(schemaFilterInput);

        return schemaFilterOutput === true || schemaFilterOutput === undefined ? schemaFilterOutput : // Keep message position and comments.
        (() => getBoundsMessage())();
    }, {
        identifier: "bounds"
    })),
);
const functionResult = Schema.String.pipe(
	Schema.check(Schema.makeFilter(function (value) {
		return value.length > 1 || "too short";
	}, { message: "length" })),
);
