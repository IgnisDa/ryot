import type { ContractPayload, ContractUrlParams } from "@ryot/contract/client";
import { IntegrationId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";

type WebhookPayload = ContractPayload<"integrations", "webhook">;
type CreateIntegrationBody = ContractPayload<"integrations", "create">;

export const createIntegration = (client: Client, body: CreateIntegrationBody) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) => c.integrations.create({ payload: body }));
		requirePresent(result.id, "Failed to create integration");
		return result;
	});

export const createKodiIntegration = (client: Client) =>
	createIntegration(client, {
		provider: "kodi",
		providerSpecifics: { kind: "kodi" },
	});

export const createAudiobookshelfIntegration = (client: Client) =>
	createIntegration(client, {
		isDisabled: true,
		provider: "audiobookshelf",
		providerSpecifics: {
			token: "test-token",
			kind: "audiobookshelf",
			baseUrl: "https://abs.example.com",
		},
	});

export const listIntegrations = (
	client: Client,
	query?: ContractUrlParams<"integrations", "list">,
) => client.call((c) => c.integrations.list({ urlParams: query ?? {} }));

export const getIntegration = (client: Client, id: string) =>
	client.call((c) => c.integrations.get({ path: { integrationId: IntegrationId.make(id) } }));

export const deleteIntegration = (client: Client, id: string) =>
	client.call((c) => c.integrations.delete({ path: { integrationId: IntegrationId.make(id) } }));

export const postIntegrationWebhook = (
	client: Client,
	integrationId: string,
	body: WebhookPayload,
) =>
	client.call((c) =>
		c.integrations.webhook({
			payload: body,
			path: { integrationId: IntegrationId.make(integrationId) },
		}),
	);
