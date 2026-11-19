import { LocaleTag, SOURCE_LOCALE, WeekDay, weekStartForLocale } from "@ryot-app/i18n/locale";
import { kernelLocales } from "@ryot-app/kernel-messages/catalog";
import { Schema } from "effect";

import { RatingScale } from "../modules/events/rating-scale";
import { TimeZone, UTC } from "./time-zone";
import { strictStruct } from "./utils";

export const InterfaceLocale = Schema.Literals(kernelLocales);
export type InterfaceLocale = typeof InterfaceLocale.Type;

export const userPreferenceFields = {
	ratingScale: RatingScale,
	reportingTimeZone: TimeZone,
	weekStart: Schema.NullOr(WeekDay),
	disableIntegrations: Schema.Boolean,
	contentLanguage: Schema.NullOr(LocaleTag),
	interfaceLocale: Schema.NullOr(InterfaceLocale),
};

export const UserPreferences = strictStruct(userPreferenceFields);
export type UserPreferences = typeof UserPreferences.Type;

export const UserPreferencesPatch = strictStruct({
	weekStart: Schema.optional(userPreferenceFields.weekStart),
	ratingScale: Schema.optional(userPreferenceFields.ratingScale),
	interfaceLocale: Schema.optional(userPreferenceFields.interfaceLocale),
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

/** Backend rendering has no device language, so an unset interface locale renders in the source locale. */
export const resolveInterfaceLocale = (
	preferences: Pick<UserPreferences, "interfaceLocale">,
): InterfaceLocale => preferences.interfaceLocale ?? SOURCE_LOCALE;

/**
 * Week boundaries must agree between backend bucketing and clients, so an unset interface locale
 * resolves through the source locale here rather than through the device language.
 */
export const resolveWeekStart = (preferences: LocalePreferences): WeekDay =>
	preferences.weekStart ?? weekStartForLocale(resolveInterfaceLocale(preferences));
