import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/account/schemas";
import { effectiveTimeZone, TimeZone } from "@ryot-app/contract/schema/time-zone";
import type { UserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { Option, Schema } from "effect";

export type PreferenceDraft = { readonly language: string; readonly reportingTimeZone: string };

export const makePreferenceDraft = (preferences: UserPreferences): PreferenceDraft => ({
	language: preferences.language ?? "",
	reportingTimeZone: effectiveTimeZone(preferences.reportingTimeZone),
});

export const preferencePayload = (
	initial: UserPreferences,
	draft: PreferenceDraft,
): UpdateUserPreferencesBody => {
	const language = draft.language.trim() || null;
	const reportingTimeZone = Schema.decodeOption(TimeZone)(draft.reportingTimeZone.trim());
	return {
		...(language === initial.language ? {} : { language }),
		...(Option.isNone(reportingTimeZone) ||
		reportingTimeZone.value === effectiveTimeZone(initial.reportingTimeZone)
			? {}
			: { reportingTimeZone: reportingTimeZone.value }),
	};
};
