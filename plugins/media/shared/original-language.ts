import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	canonicalLanguageCode,
	canonicalLanguagePattern,
	languageName,
} from "@ryot-app/plugin-kit/languages";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyText, type Table } from "./entity-selections";
import { catalogMessage } from "./messages.generated";

const OriginalLanguage = Schema.String.check(
	Schema.makeFilter(
		(value) => canonicalLanguageCode(value) === value || "Expected a canonical language code",
	),
);

export const originalLanguageFields = {
	originalLanguage: {
		type: "string" as const,
		validation: { pattern: canonicalLanguagePattern },
		label: catalogMessage("property.original-language"),
		description: "Original language code supplied by the movie or show provider",
	},
};

export const originalLanguageSelection = (entity: Table) => ({
	originalLanguage: selectedField(
		propertyText(entity, "originalLanguage"),
		Schema.NullOr(OriginalLanguage),
	),
});

export const originalLanguageFact = (label: string, code: null | string) => {
	const name = code === null ? undefined : languageName(code);
	return name === undefined ? [] : [{ label, value: name, icon: "globe" }];
};
