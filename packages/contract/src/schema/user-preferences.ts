import { LocaleTag, SOURCE_LOCALE, WeekDay, weekStartForLocale } from "@ryot-app/i18n/locale";
import { Schema } from "effect";

import { RatingScale } from "../modules/events/rating-scale";
import { TimeZone, UTC } from "./time-zone";
import { strictStruct } from "./utils";

export const userPreferenceFields = {
	ratingScale: RatingScale,
	reportingTimeZone: TimeZone,
	weekStart: Schema.NullOr(WeekDay),
	disableIntegrations: Schema.Boolean,
	contentLanguage: Schema.NullOr(LocaleTag),
	interfaceLocale: Schema.NullOr(LocaleTag),
};

export const UserPreferences = strictStruct(userPreferenceFields);
export type UserPreferences = typeof UserPreferences.Type;

export const UserPreferencesPatch = strictStruct({
	interfaceLocale: Schema.optionalKey(LocaleTag),
	weekStart: Schema.optional(userPreferenceFields.weekStart),
	ratingScale: Schema.optional(userPreferenceFields.ratingScale),
	contentLanguage: Schema.optional(userPreferenceFields.contentLanguage),
	reportingTimeZone: Schema.optional(userPreferenceFields.reportingTimeZone),
	disableIntegrations: Schema.optional(userPreferenceFields.disableIntegrations),
});
export type UserPreferencesPatch = typeof UserPreferencesPatch.Type;

export const defaultUserPreferences: UserPreferences = {
	weekStart: null,
	interfaceLocale: null,
	contentLanguage: null,
	ratingScale: "hundred",
	reportingTimeZone: UTC,
	disableIntegrations: false,
};

type LocalePreferences = Pick<UserPreferences, "weekStart" | "interfaceLocale">;

export const resolveInterfaceLocale = (preferences: Pick<UserPreferences, "interfaceLocale">) =>
	preferences.interfaceLocale ?? SOURCE_LOCALE;

export const resolveWeekStart = (preferences: LocalePreferences): WeekDay =>
	preferences.weekStart ?? weekStartForLocale(resolveInterfaceLocale(preferences));
