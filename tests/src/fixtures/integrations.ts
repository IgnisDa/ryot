import { getBackendUrl } from "../setup";
import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload, ContractUrlParams } from "./contract-client";

type WebhookResponseBody = { message?: string; runId?: string };

const normalizeWebhookResponse = (parsed: unknown): WebhookResponseBody | undefined => {
	if (typeof parsed !== "object" || parsed === null) {
		return undefined;
	}

	if ("data" in parsed) {
		const data = parsed.data;
		return typeof data === "object" && data !== null ? data : undefined;
	}

	return parsed;
};

type CreateIntegrationBody = ContractPayload<"integrations", "create">;

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
	return client.run((c) => c.integrations.get({ path: { integrationId: id } }));
}

export async function deleteIntegration(client: Client, id: string) {
	return client.run((c) => c.integrations.delete({ path: { integrationId: id } }));
}

export async function postIntegrationWebhook(
	_client: Client,
	integrationId: string,
	body?: unknown,
) {
	const response = await fetch(`${getBackendUrl()}/webhooks/integrations/${integrationId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const parsed: unknown = await response.json();
	const data = normalizeWebhookResponse(parsed);
	return { data, response };
}

export async function postWebhook(integrationId: string, body?: unknown) {
	const rootUrl = getBackendUrl().replace(/\/api$/, "");
	const response = await fetch(`${rootUrl}/_i/${integrationId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const parsed: unknown = await response.json();
	const data = normalizeWebhookResponse(parsed);
	return { response, data };
}
