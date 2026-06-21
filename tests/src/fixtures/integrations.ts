import { IntegrationId } from "@ryot/contract/schema/brands";

import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload, ContractUrlParams } from "./contract-client";

type CreateIntegrationBody = ContractPayload<"integrations", "create">;
type WebhookPayload = ContractPayload<"integrations", "webhook">;

export async function createIntegration(client: Client, body: CreateIntegrationBody) {
	const result = await client.run((c) => c.integrations.create({ payload: body }));
	requirePresent(result.id, "Failed to create integration");
	return result;
}

export async function createKodiIntegration(client: Client) {
	return createIntegration(client, {
		provider: "kodi",
		providerSpecifics: { kind: "kodi" },
	});
}

export async function createAudiobookshelfIntegration(client: Client) {
	return createIntegration(client, {
		isDisabled: true,
		provider: "audiobookshelf",
		providerSpecifics: {
			token: "test-token",
			kind: "audiobookshelf",
			baseUrl: "https://abs.example.com",
		},
	});
}

export async function listIntegrations(
	client: Client,
	query?: ContractUrlParams<"integrations", "list">,
) {
	return client.run((c) => c.integrations.list({ urlParams: query ?? {} }));
}

export async function getIntegration(client: Client, id: string) {
	return client.run((c) => c.integrations.get({ path: { integrationId: IntegrationId.make(id) } }));
}

export async function deleteIntegration(client: Client, id: string) {
	return client.run((c) =>
		c.integrations.delete({ path: { integrationId: IntegrationId.make(id) } }),
	);
}

export async function postIntegrationWebhook(
	client: Client,
	integrationId: string,
	body: WebhookPayload,
) {
	return client.run((c) =>
		c.integrations.webhook({
			payload: body,
			path: { integrationId: IntegrationId.make(integrationId) },
		}),
	);
}
