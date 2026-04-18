import type { paths } from "@ryot/generated/openapi/app-backend";

import { getBackendUrl } from "../setup";
import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";

type CreateIntegrationBody = NonNullable<
	paths["/integrations"]["post"]["requestBody"]
>["content"]["application/json"];

export async function createIntegration(
	client: Client,
	cookies: string,
	body: CreateIntegrationBody,
) {
	const { data, response } = await client.POST("/integrations", {
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
	query?: NonNullable<paths["/integrations"]["get"]["parameters"]>["query"],
) {
	const { data, response } = await client.GET("/integrations", {
		params: { query },
		headers: { Cookie: cookies },
	});
	return requireResponseData(response, data, "Failed to list integrations");
}

export async function getIntegration(client: Client, cookies: string, id: string) {
	const { data, response } = await client.GET("/integrations/{integrationId}", {
		headers: { Cookie: cookies },
		params: { path: { integrationId: id } },
	});
	return requireResponseData(response, data, `Failed to get integration '${id}'`);
}

export async function deleteIntegration(client: Client, cookies: string, id: string) {
	const { data, response } = await client.DELETE("/integrations/{integrationId}", {
		headers: { Cookie: cookies },
		params: { path: { integrationId: id } },
	});
	return requireResponseData(response, data, `Failed to delete integration '${id}'`);
}

export async function postWebhook(integrationId: string, body?: unknown) {
	const rootUrl = getBackendUrl().replace(/\/api$/, "");
	const response = await fetch(`${rootUrl}/_i/${integrationId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const data: { data?: { runId: string }; error?: { message: string; code: string } } =
		await response.json();
	return { response, data };
}
