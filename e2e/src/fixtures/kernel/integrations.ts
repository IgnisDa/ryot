import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import { integrationRecipe, integrationsRecipe } from "@ryot-app/ryotql-recipes/integrations";
import { Effect, Option } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { pollImportRunUntilTerminal } from "./imports";
import { collectRyotQLRecipeItems, executeRyotQLRecipe } from "./ryotql";

type CreateIntegrationBody = ContractPayload<"integrations", "create">;

export const createIntegration = (client: Client, body: CreateIntegrationBody) =>
	client.call((c) => c.integrations.create({ payload: body }));

export const createKodiIntegration = (client: Client) =>
	createIntegration(client, { provider: "kodi", providerSpecifics: { kind: "kodi" } });

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
	collectRyotQLRecipeItems(client, (after) =>
		integrationsRecipe({
			provider: options.provider,
			after: after ?? options.after,
			isDisabled: options.isDisabled,
			limit: Math.min(options.limit ?? 100, 100),
		}),
	);

export const getIntegration = (client: Client, id: string) =>
	executeRyotQLRecipe(client, integrationRecipe({ id }));

export const deleteIntegration = (client: Client, id: string) =>
	client.call((c) => c.integrations.delete({ params: { integrationId: IntegrationId.make(id) } }));

export const syncIntegrations = (client: Client) => client.call((c) => c.integrations.sync());

export const postIntegrationWebhook = (
	client: Client,
	integration: ContractSuccess<"integrations", "create">,
	body: JsonValue,
	detailClient: Client = client,
) =>
	Effect.gen(function* () {
		const detail = requirePresent(
			Option.getOrUndefined(yield* getIntegration(detailClient, integration.id)),
			"Expected sink integration detail",
		);
		const webhookToken = requirePresent(
			detail.webhookToken,
			"Expected sink integration webhook token",
		);
		return yield* client.call((c) =>
			c.integrations.webhook({ params: { webhookToken }, payload: JSON.stringify(body) }),
		);
	});

export const postIntegrationWebhookAndWait = (
	client: Client,
	integration: ContractSuccess<"integrations", "create">,
	body: JsonValue,
) =>
	Effect.gen(function* () {
		const data = yield* postIntegrationWebhook(client, integration, body);
		const runId = requirePresent(data.runId, "Expected runId from webhook");
		const run = yield* pollImportRunUntilTerminal(client, runId);
		return { run, data, runId };
	});
