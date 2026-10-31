import { Schema } from "effect";

import { TimeZone, UTC } from "./time-zone";
import { strictStruct } from "./utils";

const StoredLanguage = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => value.length > 0 && value === value.trim())),
);

export const userPreferenceFields = {
	reportingTimeZone: TimeZone,
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
	reportingTimeZone: Schema.optional(userPreferenceFields.reportingTimeZone),
	disableIntegrations: Schema.optional(userPreferenceFields.disableIntegrations),
});
export type UserPreferencesPatch = typeof UserPreferencesPatch.Type;

export const defaultUserPreferences: UserPreferences = {
	language: null,
	reportingTimeZone: UTC,
	disableIntegrations: false,
};
