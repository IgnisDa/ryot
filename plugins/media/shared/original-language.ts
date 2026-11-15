import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	canonicalLanguageCode,
	canonicalLanguagePattern,
	languageName,
} from "@ryot-app/plugin-kit/languages";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyText, type Table } from "./entity-selections";

const OriginalLanguage = Schema.String.check(
	Schema.makeFilter(
		(value) => canonicalLanguageCode(value) === value || "Expected a canonical language code",
	),
);

export const originalLanguageFields = {
	originalLanguage: {
		type: "string" as const,
		label: "Original language",
		validation: { pattern: canonicalLanguagePattern },
		description: "Original language code supplied by the movie or show provider",
	},
};

export const originalLanguageSelection = (entity: Table) => ({
	originalLanguage: selectedField(
		propertyText(entity, "originalLanguage"),
		Schema.NullOr(OriginalLanguage),
	),
});

export const originalLanguageFact = (code: null | string) => {
	const name = code === null ? undefined : languageName(code);
	return name === undefined ? [] : [{ value: name, icon: "globe", label: "Original language" }];
};
