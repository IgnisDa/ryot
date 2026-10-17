import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { integrationRecipe, integrationsRecipe } from "@ryot-app/ryotql-recipes/integrations";
import { Effect, Option } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { pollImportRunUntilTerminal } from "./imports";
import { findPluginInstallationByPackage } from "./plugins";
import { collectRyotQLRecipeItems, executeRyotQLRecipe } from "./ryotql";

type CreateIntegrationBody = ContractPayload<"integrations", "create">;

export const createIntegration = (client: Client, body: CreateIntegrationBody) =>
	client.call((c) => c.integrations.create({ payload: body }));

export const createKodiIntegration = (client: Client) =>
	Effect.gen(function* () {
		const installation = yield* findPluginInstallationByPackage(client, {
			scope: "system",
			packageId: mediaPlugin.metadata.packageId,
		});
		return yield* createIntegration(client, {
			providerSpecifics: { kind: "kodi" },
			provider: { slug: "kodi", owner: { kind: "plugin", pluginId: installation.pluginId } },
		});
	});

export const createAudiobookshelfIntegration = (client: Client) =>
	Effect.gen(function* () {
		const installation = yield* findPluginInstallationByPackage(client, {
			scope: "system",
			packageId: mediaPlugin.metadata.packageId,
		});
		return yield* createIntegration(client, {
			name: "ABS",
			isDisabled: true,
			provider: {
				slug: "audiobookshelf",
				owner: { kind: "plugin", pluginId: installation.pluginId },
			},
			providerSpecifics: {
				token: "test-token",
				kind: "audiobookshelf",
				baseUrl: "https://abs.example.com",
			},
		});
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
			c.integrations.webhook({
				headers: {},
				params: { webhookToken },
				payload: JSON.stringify(body),
			}),
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
