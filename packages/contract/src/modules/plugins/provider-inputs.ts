import { Schema } from "effect";

export const ProviderTranslationInputs = Schema.Record(
	Schema.NonEmptyString,
	Schema.Array(Schema.NonEmptyString).pipe(
		Schema.check(Schema.makeFilter((keys) => new Set(keys).size === keys.length)),
	),
).pipe(Schema.check(Schema.makeFilter((inputs) => Object.keys(inputs).length > 0)));
