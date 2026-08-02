import type { ContractPayload } from "@ryot/contract/client";
import { IntegrationId } from "@ryot/contract/schema/brands";
import { integrationRecipe, integrationsRecipe } from "@ryot/ryotql-recipes/integrations";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { pollImportRunUntilTerminal } from "./imports";
import { executeRyotQLRecipe } from "./ryotql";

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
	Effect.gen(function* () {
		const { id } = yield* createIntegration(client, {
			name: "ABS",
			isDisabled: true,
			provider: "audiobookshelf",
			providerSpecifics: {
				token: "test-token",
				kind: "audiobookshelf",
				baseUrl: "https://abs.example.com",
			},
		});
		return requirePresent(yield* getIntegration(client, id), "Created integration not found");
	});

export const listIntegrations = (
	client: Client,
	options: Partial<Parameters<typeof integrationsRecipe>[0]> = {},
) =>
	executeRyotQLRecipe(
		client,
		integrationsRecipe({
			after: options.after,
			provider: options.provider,
			limit: options.limit ?? 100,
			isDisabled: options.isDisabled,
		}),
	).pipe(Effect.map((result) => result.items));

export const getIntegration = (client: Client, id: string) =>
	executeRyotQLRecipe(client, integrationRecipe({ id }));

export const deleteIntegration = (client: Client, id: string) =>
	client.call((c) => c.integrations.delete({ params: { integrationId: IntegrationId.make(id) } }));

export const postIntegrationWebhook = (
	client: Client,
	integrationId: string,
	body: WebhookPayload,
) =>
	client.call((c) =>
		c.integrations.webhook({
			payload: body,
			params: { integrationId: IntegrationId.make(integrationId) },
		}),
	);

export const postIntegrationWebhookAndWait = (
	client: Client,
	integrationId: string,
	body: WebhookPayload,
) =>
	Effect.gen(function* () {
		const data = yield* postIntegrationWebhook(client, integrationId, body);
		const runId = requirePresent(data.runId, "Expected runId from webhook");
		const run = yield* pollImportRunUntilTerminal(client, runId);
		return { run, data, runId };
	});
