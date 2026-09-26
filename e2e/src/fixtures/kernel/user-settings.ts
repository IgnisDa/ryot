import type { ContractPayload } from "@ryot-app/contract/client";
import { userSettingsRecipe } from "@ryot-app/ryotql-recipes/user-settings";

import type { Client } from "./auth";
import { executeRyotQLRecipe } from "./ryotql";

type UpdateUserSettingsPreferencesBody = ContractPayload<"userSettings", "updatePreferences">;

export const getUserSettings = (client: Client) =>
	executeRyotQLRecipe(client, userSettingsRecipe());

export const refreshUserAvatar = (client: Client) =>
	client.call((c) => c.userSettings.refreshAvatar());

export const updateUserSettingsPreferences = (
	client: Client,
	payload: UpdateUserSettingsPreferencesBody,
) => client.call((c) => c.userSettings.updatePreferences({ payload }));

export const setUserLanguage = (client: Client, language: string) =>
	updateUserSettingsPreferences(client, { language });
