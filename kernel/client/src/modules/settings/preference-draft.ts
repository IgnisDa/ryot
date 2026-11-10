import type { RatingScale } from "@ryot-app/contract/modules/events/rating-scale";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import type {
	UserPreferences,
	UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import { Option, Schema } from "effect";

export type PreferenceDraft = {
	readonly language: string;
	readonly ratingScale: RatingScale;
	readonly reportingTimeZone: string;
};

export const makePreferenceDraft = (preferences: UserPreferences): PreferenceDraft => ({
	language: preferences.language ?? "",
	ratingScale: preferences.ratingScale,
	reportingTimeZone: preferences.reportingTimeZone,
});

export const preferencePayload = (
	initial: UserPreferences,
	draft: PreferenceDraft,
): UserPreferencesPatch => {
	const language = draft.language.trim() || null;
	const reportingTimeZone = Schema.decodeOption(TimeZone)(draft.reportingTimeZone.trim());
	return {
		...(language === initial.language ? {} : { language }),
		...(draft.ratingScale === initial.ratingScale ? {} : { ratingScale: draft.ratingScale }),
		...(Option.isNone(reportingTimeZone) || reportingTimeZone.value === initial.reportingTimeZone
			? {}
			: { reportingTimeZone: reportingTimeZone.value }),
	};
};
