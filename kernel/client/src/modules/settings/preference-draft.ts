import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/account/schemas";
import type { UserPreferences } from "@ryot-app/contract/schema/user-preferences";

export type PreferenceDraft = { readonly language: string; readonly reportingTimeZone: string };

export const makePreferenceDraft = (preferences: UserPreferences): PreferenceDraft => ({
	language: preferences.language ?? "",
	reportingTimeZone: preferences.reportingTimeZone ?? "UTC",
});

export const preferencePayload = (
	initial: UserPreferences,
	draft: PreferenceDraft,
): UpdateUserPreferencesBody => {
	const language = draft.language.trim() || null;
	const reportingTimeZone = draft.reportingTimeZone.trim();
	return {
		...(language === initial.language ? {} : { language }),
		...(reportingTimeZone === (initial.reportingTimeZone ?? "UTC") ? {} : { reportingTimeZone }),
	};
};
