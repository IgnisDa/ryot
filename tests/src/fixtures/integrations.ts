import { getBackendUrl } from "../setup";
import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ClientBody, ClientQuery } from "./backend-client";

type CreateIntegrationBody = ClientBody<"integrations", "create">;

export async function createIntegration(
	client: Client,
	cookies: string,
	body: CreateIntegrationBody,
) {
	const { data, response } = await client.integrations.create({
		body,
		headers: { Cookie: cookies },
	});
	const result = requireResponseData(response, data, "Failed to create integration");
	requirePresent(result.id, "Failed to create integration");
	return result;
}

export async function createKodiIntegration(client: Client, cookies: string) {
	return createIntegration(client, cookies, {
		provider: "kodi",
		providerSpecifics: { kind: "kodi" },
	});
}

export async function createAudiobookshelfIntegration(client: Client, cookies: string) {
	return createIntegration(client, cookies, {
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
	cookies: string,
	query?: ClientQuery<"integrations", "list">,
) {
	const { data, response } = await client.integrations.list({
		headers: { Cookie: cookies },
		params: { query: query ?? {} },
	});
	return requireResponseData(response, data, "Failed to list integrations");
}

export async function getIntegration(client: Client, cookies: string, id: string) {
	const { data, response } = await client.integrations.get({
		headers: { Cookie: cookies },
		params: { path: { integrationId: id } },
	});
	return requireResponseData(response, data, `Failed to get integration '${id}'`);
}

export async function deleteIntegration(client: Client, cookies: string, id: string) {
	const { data, response } = await client.integrations.delete({
		headers: { Cookie: cookies },
		params: { path: { integrationId: id } },
	});
	return requireResponseData(response, data, `Failed to delete integration '${id}'`);
}

export async function postIntegrationWebhook(
	client: Client,
	integrationId: string,
	body?: unknown,
) {
	return client.integrations.webhook({
		body,
		params: { path: { integrationId } },
	});
}

export async function postWebhook(integrationId: string, body?: unknown) {
	const rootUrl = getBackendUrl().replace(/\/api$/, "");
	const response = await fetch(`${rootUrl}/_i/${integrationId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const parsed = (await response.json()) as
		| { runId?: string; message?: string }
		| { data?: { runId?: string }; error?: { message?: string } };
	const data =
		typeof parsed === "object" && parsed !== null && "data" in parsed ? parsed.data : parsed;
	return { response, data };
}
