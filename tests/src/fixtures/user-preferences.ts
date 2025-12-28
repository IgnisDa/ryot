import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";

type UpdateUserPreferencesBody = ContractPayload<"userPreferences", "update">;

export const updateUserPreferences = (client: Client, payload: UpdateUserPreferencesBody) =>
	client.call((c) => c.userPreferences.update({ payload }));

export const setUserLanguage = (client: Client, language: string) =>
	updateUserPreferences(client, { language });
