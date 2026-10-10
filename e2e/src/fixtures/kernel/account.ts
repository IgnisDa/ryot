import type { ContractPayload } from "@ryot-app/contract/client";
import { userSettingsRecipe } from "@ryot-app/ryotql-recipes/user-settings";

import type { Client } from "./auth";
import { executeRyotQLRecipe } from "./ryotql";

type UpdateAccountPreferencesBody = ContractPayload<"account", "updatePreferences">;

export const getUserSettings = (client: Client) =>
	executeRyotQLRecipe(client, userSettingsRecipe());

export const refreshUserAvatar = (client: Client) => client.call((c) => c.account.refreshAvatar());

export const getTwoFactorStatus = (client: Client) =>
	client.call((c) => c.account.getTwoFactorStatus());

export const updateUserSettingsPreferences = (
	client: Client,
	payload: UpdateAccountPreferencesBody,
) => client.call((c) => c.account.updatePreferences({ payload }));

export const setUserLanguage = (client: Client, language: string) =>
	updateUserSettingsPreferences(client, { language });
