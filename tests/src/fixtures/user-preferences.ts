import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";

type UpdateUserPreferencesBody = ContractPayload<"userPreferences", "update">;
type UpdateUserPreferencesData = ContractSuccess<"userPreferences", "update">;

export async function updateUserPreferences(
	client: Client,
	payload: UpdateUserPreferencesBody,
): Promise<UpdateUserPreferencesData> {
	return client.run((c) => c.userPreferences.update({ payload }));
}

export async function setUserLanguage(client: Client, language: string) {
	return updateUserPreferences(client, { language });
}
