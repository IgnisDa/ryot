import type {
	UpdateUserPreferencesBody,
	UserPreferences,
} from "@ryot-app/contract/modules/user-settings/schemas";

export type PreferenceDraft = {
	readonly language: string;
	readonly allowNsfw: boolean;
	readonly disableIntegrations: boolean;
};

export const makePreferenceDraft = (preferences: UserPreferences): PreferenceDraft => ({
	allowNsfw: preferences.allowNsfw,
	language: preferences.language ?? "",
	disableIntegrations: preferences.disableIntegrations,
});

export const preferencePayload = (
	initial: UserPreferences,
	draft: PreferenceDraft,
): UpdateUserPreferencesBody => {
	const language = draft.language.trim() || null;
	return {
		...(language === initial.language ? {} : { language }),
		...(draft.allowNsfw === initial.allowNsfw ? {} : { allowNsfw: draft.allowNsfw }),
		...(draft.disableIntegrations === initial.disableIntegrations
			? {}
			: { disableIntegrations: draft.disableIntegrations }),
	};
};
