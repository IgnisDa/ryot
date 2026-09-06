import { Schema } from "effect";

import { strictStruct } from "./utils";

const StoredLanguage = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => value.length > 0 && value === value.trim())),
);

export const userPreferenceFields = {
	allowNsfw: Schema.Boolean,
	disableIntegrations: Schema.Boolean,
	language: Schema.NullOr(Schema.String),
};

export const UserPreferences = strictStruct({
	...userPreferenceFields,
	language: Schema.NullOr(StoredLanguage),
});
export type UserPreferences = typeof UserPreferences.Type;

export const UserPreferencesPatch = strictStruct({
	language: Schema.optional(userPreferenceFields.language),
	allowNsfw: Schema.optional(userPreferenceFields.allowNsfw),
	disableIntegrations: Schema.optional(userPreferenceFields.disableIntegrations),
});
export type UserPreferencesPatch = typeof UserPreferencesPatch.Type;

export const defaultUserPreferences: UserPreferences = {
	language: null,
	allowNsfw: false,
	disableIntegrations: false,
};
