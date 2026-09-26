import { createRyotMutation, createRyotQuery } from "@ryot-app/client-sdk/react";
import type { ContractSuccess } from "@ryot-app/contract/client";
import { integrationWebhookUrl } from "@ryot-app/contract/modules/integrations/schemas";
import type {
	CreateIntegrationBody,
	UpdateIntegrationBody,
} from "@ryot-app/contract/modules/integrations/schemas";
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import { integrationImportRunsRecipe } from "@ryot-app/ryotql-recipes/import-runs";
import type { ImportRunList } from "@ryot-app/ryotql-recipes/import-runs";
import {
	integrationProvidersRecipe,
	type IntegrationProvidersPage,
} from "@ryot-app/ryotql-recipes/integration-providers";
import {
	integrationRecipe,
	integrationsRecipe,
	type IntegrationDetail,
	type IntegrationList,
} from "@ryot-app/ryotql-recipes/integrations";
import { Context, Data, Effect, Layer, Option } from "effect";

import { IntegrationsApi } from "#/api/integrations";
import { PublicApi } from "#/api/public";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import type { KernelHostServices } from "#/host-services";

export const INTEGRATIONS_PAGE_SIZE = 20;
export const INTEGRATION_RUNS_PAGE_SIZE = 10;

export type IntegrationProviderItem = Omit<
	IntegrationProvidersPage["items"][number],
	"id" | "hasScript"
> & { readonly isCreatable: boolean };

export type IntegrationClientDetail = Omit<
	IntegrationDetail extends Option.Option<infer Row> ? Row : never,
	"webhookToken"
> & { readonly webhookUrl?: string };

type IntegrationsClient = Pick<KernelRyotClient, "data">;

export class IntegrationsLoadError extends Data.TaggedError("IntegrationsLoadError")<{
	readonly cause: unknown;
	readonly stage: "list" | "runs";
}> {}

export class IntegrationsService extends Context.Service<IntegrationsService>()(
	"IntegrationsService",
	{
		make: Effect.sync(() => {
			const loadIntegrations = Effect.fn("IntegrationsService.loadIntegrations")(function* (
				client: IntegrationsClient,
				input: { readonly limit: number },
			) {
				return yield* Effect.tryPromise({
					catch: (cause) => new IntegrationsLoadError({ cause, stage: "list" }),
					try: (signal) =>
						client.data.query(integrationsRecipe({ limit: input.limit }), { signal }),
				});
			});
			const loadRuns = Effect.fn("IntegrationsService.loadRuns")(function* (
				client: IntegrationsClient,
				input: { readonly limit: number; readonly integrationId: string },
			) {
				return yield* Effect.tryPromise({
					catch: (cause) => new IntegrationsLoadError({ cause, stage: "runs" }),
					try: (signal) =>
						client.data.query(
							integrationImportRunsRecipe({
								limit: input.limit,
								integrationId: input.integrationId,
							}),
							{ signal },
						),
				});
			});

			const loadProviders = Effect.fn("IntegrationsService.loadProviders")(function* (
				client: IntegrationsClient,
				serverUrl: ApiScope["serverUrl"],
			) {
				const api = yield* PublicApi;
				const config = yield* api.getSystemConfig(serverUrl).pipe(Effect.orElseSucceed(() => null));
				const providers: IntegrationProviderItem[] = [];
				let after: string | undefined | null;
				do {
					const page = yield* Effect.tryPromise({
						catch: (cause) => new IntegrationsLoadError({ cause, stage: "list" }),
						try: (signal) =>
							client.data.query(
								integrationProvidersRecipe({ limit: 100, after: after ?? undefined }),
								{ signal },
							),
					});
					providers.push(
						...page.items.map(({ id: _id, hasScript, ...provider }) => ({
							...provider,
							isCreatable:
								hasScript &&
								(!provider.requiresProKey || config?.pro.isServerKeyValidated === true),
						})),
					);
					after = page.pageInfo.nextCursor;
				} while (after !== null);
				return providers;
			});
			const loadIntegration = Effect.fn("IntegrationsService.loadIntegration")(function* (
				client: IntegrationsClient,
				serverUrl: ApiScope["serverUrl"],
				id: string,
			) {
				const result = yield* Effect.tryPromise({
					catch: (cause) => new IntegrationsLoadError({ cause, stage: "list" }),
					try: (signal) => client.data.query(integrationRecipe({ id }), { signal }),
				});
				if (Option.isNone(result)) {
					return Option.none();
				}
				const { webhookToken, ...integration } = result.value;
				if (webhookToken === null) {
					return Option.some(integration);
				}
				const api = yield* PublicApi;
				const config = yield* api.getSystemConfig(serverUrl);
				return Option.some({
					...integration,
					webhookUrl: integrationWebhookUrl(config.frontendOrigin, webhookToken),
				});
			});

			return { loadRuns, loadProviders, loadIntegration, loadIntegrations };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

const loadIntegrations = Effect.fnUntraced(function* (
	client: IntegrationsClient,
	input: { readonly limit: number },
) {
	const service = yield* IntegrationsService;
	return yield* service.loadIntegrations(client, input);
});

const loadRuns = Effect.fnUntraced(function* (
	client: IntegrationsClient,
	input: { readonly limit: number; readonly integrationId: string },
) {
	const service = yield* IntegrationsService;
	return yield* service.loadRuns(client, input);
});

export const getIntegration = Effect.fnUntraced(function* (
	client: IntegrationsClient,
	serverUrl: ApiScope["serverUrl"],
	integrationId: string,
) {
	const service = yield* IntegrationsService;
	return yield* service.loadIntegration(client, serverUrl, integrationId);
});

const syncIntegrations = Effect.fnUntraced(function* (scope: ApiScope) {
	const api = yield* IntegrationsApi;
	return yield* api.sync(scope);
});

const createIntegration = Effect.fnUntraced(function* (
	scope: ApiScope,
	payload: CreateIntegrationBody,
) {
	const api = yield* IntegrationsApi;
	return yield* api.create(scope, { payload });
});

const updateIntegration = Effect.fnUntraced(function* (
	scope: ApiScope,
	integrationId: string,
	payload: UpdateIntegrationBody,
) {
	const api = yield* IntegrationsApi;
	return yield* api.update(scope, {
		payload,
		params: { integrationId: IntegrationId.make(integrationId) },
	});
});

const deleteIntegration = Effect.fnUntraced(function* (scope: ApiScope, integrationId: string) {
	const api = yield* IntegrationsApi;
	return yield* api.delete(scope, { params: { integrationId: IntegrationId.make(integrationId) } });
});

export const integrationsQuery = createRyotQuery<number, IntegrationList, KernelHostServices>(
	({ input, client, signal, hostServices }) =>
		hostServices.runtime.runPromise(loadIntegrations(client, { limit: input }), { signal }),
);

export const integrationRunsQuery = createRyotQuery<string, ImportRunList, KernelHostServices>(
	({ input, client, signal, hostServices }) =>
		hostServices.runtime.runPromise(
			loadRuns(client, { integrationId: input, limit: INTEGRATION_RUNS_PAGE_SIZE }),
			{ signal },
		),
);

export const integrationProvidersQuery = createRyotQuery<
	void,
	readonly IntegrationProviderItem[],
	KernelHostServices
>(({ client, signal, hostServices }) =>
	hostServices.runtime.runPromise(
		Effect.flatMap(IntegrationsService, (service) =>
			service.loadProviders(client, hostServices.scope.serverUrl),
		),
		{ signal },
	),
);

export const integrationDetailQuery = createRyotQuery<
	string,
	IntegrationClientDetail | undefined,
	KernelHostServices
>(async ({ input, client, signal, hostServices }) => {
	const result = await hostServices.runtime.runPromise(
		getIntegration(client, hostServices.scope.serverUrl, input),
		{ signal },
	);
	return Option.getOrUndefined(result);
});

export const syncIntegrationsMutation = createRyotMutation<
	void,
	ContractSuccess<"integrations", "sync">,
	KernelHostServices
>(async ({ client, signal, hostServices }) => {
	const result = await hostServices.runtime.runPromise(syncIntegrations(hostServices.scope), {
		signal,
	});
	client.mutationCompleted.hint();
	return result;
});

export const createIntegrationMutation = createRyotMutation<
	CreateIntegrationBody,
	ContractSuccess<"integrations", "create">,
	KernelHostServices
>(async ({ input, client, signal, hostServices }) => {
	const result = await hostServices.runtime.runPromise(
		createIntegration(hostServices.scope, input),
		{ signal },
	);
	client.mutationCompleted.hint();
	return result;
});

export const updateIntegrationMutation = createRyotMutation<
	{ readonly id: string; readonly payload: UpdateIntegrationBody },
	ContractSuccess<"integrations", "update">,
	KernelHostServices
>(async ({ input, client, signal, hostServices }) => {
	const result = await hostServices.runtime.runPromise(
		updateIntegration(hostServices.scope, input.id, input.payload),
		{ signal },
	);
	client.mutationCompleted.hint();
	return result;
});

export const deleteIntegrationMutation = createRyotMutation<
	string,
	ContractSuccess<"integrations", "delete">,
	KernelHostServices
>(async ({ input, client, signal, hostServices }) => {
	const result = await hostServices.runtime.runPromise(
		deleteIntegration(hostServices.scope, input),
		{ signal },
	);
	client.mutationCompleted.hint();
	return result;
});
