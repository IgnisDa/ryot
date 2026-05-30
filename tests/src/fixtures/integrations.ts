import { getBackendUrl } from "../setup";
import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ClientBody, ClientQuery, ClientSuccess } from "./backend-client";

type CreateIntegrationBody = ClientBody<"integrations", "create">;
type IntegrationRecord = Omit<
	ClientSuccess<"integrations", "get">,
	"extraSettings" | "providerSpecifics"
> & {
	extraSettings: Record<string, unknown>;
	providerSpecifics: { kind?: string } & Record<string, unknown>;
};

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
		params: { query },
		headers: { Cookie: cookies },
	});

	// TODO(Task 22): Remove this tests-only integration assertion once the public
	// AppContract exposes typed integration-specific fields.
	return requireResponseData(response, data, "Failed to list integrations") as IntegrationRecord[];
}

export async function getIntegration(client: Client, cookies: string, id: string) {
	const { data, response } = await client.integrations.get({
		headers: { Cookie: cookies },
		params: { path: { integrationId: id } },
	});

	// TODO(Task 22): Remove this tests-only integration assertion once the public
	// AppContract exposes typed integration-specific fields.
	return requireResponseData(
		response,
		data,
		`Failed to get integration '${id}'`,
	) as IntegrationRecord;
}

export async function deleteIntegration(client: Client, cookies: string, id: string) {
	const { data, response } = await client.integrations.delete({
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
