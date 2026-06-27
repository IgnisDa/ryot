import type { ContractPayload } from "@ryot/contract/client";

import type { Client } from "./auth";

type UpdateUserPreferencesBody = ContractPayload<"userPreferences", "update">;

export const updateUserPreferences = (client: Client, payload: UpdateUserPreferencesBody) =>
	client.call((c) => c.userPreferences.update({ payload }));

export const setUserLanguage = (client: Client, language: string) =>
	updateUserPreferences(client, { language });
