import { Schema } from "effect";

import { RatingScale } from "../modules/events/rating-scale";
import { TimeZone, UTC } from "./time-zone";
import { strictStruct } from "./utils";

const StoredLanguage = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => value.length > 0 && value === value.trim())),
);

export const userPreferenceFields = {
	ratingScale: RatingScale,
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
	ratingScale: Schema.optional(userPreferenceFields.ratingScale),
	reportingTimeZone: Schema.optional(userPreferenceFields.reportingTimeZone),
	disableIntegrations: Schema.optional(userPreferenceFields.disableIntegrations),
});
export type UserPreferencesPatch = typeof UserPreferencesPatch.Type;

export const defaultUserPreferences: UserPreferences = {
	language: null,
	ratingScale: "hundred",
	reportingTimeZone: UTC,
	disableIntegrations: false,
};
