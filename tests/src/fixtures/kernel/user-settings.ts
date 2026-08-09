import type { ContractPayload } from "@ryot/contract/client";

import type { Client } from "./auth";

type UpdateUserSettingsPreferencesBody = ContractPayload<"userSettings", "updatePreferences">;

export const getUserSettings = (client: Client) => client.call((c) => c.userSettings.get());

export const refreshUserAvatar = (client: Client) =>
	client.call((c) => c.userSettings.refreshAvatar());

export const updateUserSettingsPreferences = (
	client: Client,
	payload: UpdateUserSettingsPreferencesBody,
) => client.call((c) => c.userSettings.updatePreferences({ payload }));

export const setUserLanguage = (client: Client, language: string) =>
	updateUserSettingsPreferences(client, { language });
