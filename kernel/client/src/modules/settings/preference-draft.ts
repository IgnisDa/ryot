import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/user-settings/schemas";
import type { UserPreferences } from "@ryot-app/contract/schema/user-preferences";

export type PreferenceDraft = { readonly language: string };

export const makePreferenceDraft = (preferences: UserPreferences): PreferenceDraft => ({
	language: preferences.language ?? "",
});

export const preferencePayload = (
	initial: UserPreferences,
	draft: PreferenceDraft,
): UpdateUserPreferencesBody => {
	const language = draft.language.trim() || null;
	return language === initial.language ? {} : { language };
};
