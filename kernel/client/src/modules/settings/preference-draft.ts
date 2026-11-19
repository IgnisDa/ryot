import type { RatingScale } from "@ryot-app/contract/modules/events/rating-scale";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import {
	InterfaceLocale,
	type UserPreferences,
	type UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import { canonicalLocale, WeekDay } from "@ryot-app/i18n/locale";
import { Option, Schema } from "effect";

type PreferenceDraft = {
	readonly weekStart: string;
	readonly interfaceLocale: string;
	readonly contentLanguage: string;
	readonly ratingScale: RatingScale;
	readonly reportingTimeZone: string;
};

const decodeInterfaceLocale = Schema.decodeUnknownOption(InterfaceLocale);
const decodeWeekStart = Schema.decodeUnknownOption(WeekDay);

export const makePreferenceDraft = (preferences: UserPreferences): PreferenceDraft => ({
	ratingScale: preferences.ratingScale,
	reportingTimeZone: preferences.reportingTimeZone,
	interfaceLocale: preferences.interfaceLocale ?? "",
	contentLanguage: preferences.contentLanguage ?? "",
	weekStart: preferences.weekStart === null ? "" : String(preferences.weekStart),
});

export const preferencePayload = (
	initial: UserPreferences,
	draft: PreferenceDraft,
): UserPreferencesPatch => {
	const contentLanguageInput = draft.contentLanguage.trim();
	const contentLanguage =
		contentLanguageInput === ""
			? null
			: (canonicalLocale(contentLanguageInput) ?? contentLanguageInput);
	const interfaceLocale =
		draft.interfaceLocale === "" ? Option.some(null) : decodeInterfaceLocale(draft.interfaceLocale);
	const weekStart =
		draft.weekStart === "" ? Option.some(null) : decodeWeekStart(Number(draft.weekStart));
	const reportingTimeZone = Schema.decodeOption(TimeZone)(draft.reportingTimeZone.trim());
	return {
		...(contentLanguage === initial.contentLanguage ? {} : { contentLanguage }),
		...(draft.ratingScale === initial.ratingScale ? {} : { ratingScale: draft.ratingScale }),
		...(Option.isNone(weekStart) || weekStart.value === initial.weekStart
			? {}
			: { weekStart: weekStart.value }),
		...(Option.isNone(interfaceLocale) || interfaceLocale.value === initial.interfaceLocale
			? {}
			: { interfaceLocale: interfaceLocale.value }),
		...(Option.isNone(reportingTimeZone) || reportingTimeZone.value === initial.reportingTimeZone
			? {}
			: { reportingTimeZone: reportingTimeZone.value }),
	};
};
