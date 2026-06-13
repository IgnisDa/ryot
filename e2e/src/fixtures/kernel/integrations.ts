import type { ContractPayload } from "@ryot-app/contract/client";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import { integrationRecipe, integrationsRecipe } from "@ryot-app/ryotql-recipes/integrations";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { pollImportRunUntilTerminal } from "./imports";
import { executeRyotQLRecipe } from "./ryotql";

type CreateIntegrationBody = ContractPayload<"integrations", "create">;

export const createIntegration = (client: Client, body: CreateIntegrationBody) =>
	client.call((c) => c.integrations.create({ payload: body }));

export const createKodiIntegration = (client: Client) =>
	createIntegration(client, {
		provider: "kodi",
		providerSpecifics: { kind: "kodi" },
	});

export const createAudiobookshelfIntegration = (client: Client) =>
	createIntegration(client, {
		name: "ABS",
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

export const syncIntegrations = (client: Client) => client.call((c) => c.integrations.sync());

export const postIntegrationWebhook = (client: Client, integrationId: string, body: JsonValue) =>
	client.call((c) =>
		c.integrations.webhook({
			payload: JSON.stringify(body),
			params: { integrationId: IntegrationId.make(integrationId) },
		}),
	);

export const postIntegrationWebhookAndWait = (
	client: Client,
	integrationId: string,
	body: JsonValue,
) =>
	Effect.gen(function* () {
		const data = yield* postIntegrationWebhook(client, integrationId, body);
		const runId = requirePresent(data.runId, "Expected runId from webhook");
		const run = yield* pollImportRunUntilTerminal(client, runId);
		return { run, data, runId };
	});
