import type { ContractRequest } from "@ryot-app/contract/client";
import type { CreatedApiKey } from "@ryot-app/contract/modules/account/schemas";
import type { ApiKeyId } from "@ryot-app/contract/schema/brands";
import { createRyotHostMutation, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { type ApiKeysPage, apiKeysRecipe } from "@ryot-app/ryotql-recipes/api-keys";
import { Effect } from "effect";

import { AccountApi } from "#/api/account";
import type { AuthenticatedApiError } from "#/api/authenticated";
import { KernelHostServices } from "#/host-services";

const API_KEYS_PAGE_SIZE = 50;

export const apiKeysQuery = createRyotQuery<string | undefined, ApiKeysPage>(
	({ client, input: after }) =>
		client.data.query(apiKeysRecipe, {}, { pages: { keys: { after, limit: API_KEYS_PAGE_SIZE } } }),
	{ cancelOnUnmount: true },
);

export const createApiKeyMutation = createRyotHostMutation<
	ContractRequest<"account", "createApiKey">["payload"],
	CreatedApiKey,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AccountApi)
			.createApiKey(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);

export const revokeApiKeyMutation = createRyotHostMutation<
	ApiKeyId,
	void,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AccountApi)
			.revokeApiKey(hostServices.scope, { params: { apiKeyId: input } })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);
