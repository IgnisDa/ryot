import { createRyotMutation, createRyotQuery } from "@ryot-app/client-sdk/react";
import type { ContractSuccess } from "@ryot-app/contract/client";
import type {
	CreateIntegrationBody,
	ListedIntegration,
	ListedIntegrationProvider,
	UpdateIntegrationBody,
} from "@ryot-app/contract/modules/integrations/schemas";
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import { integrationImportRunsRecipe } from "@ryot-app/ryotql-recipes/import-runs";
import type { ImportRunList } from "@ryot-app/ryotql-recipes/import-runs";
import { integrationsRecipe, type IntegrationList } from "@ryot-app/ryotql-recipes/integrations";
import { Context, Data, Effect, Layer } from "effect";

import { IntegrationsApi } from "#/api/integrations";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import type { KernelHostServices } from "#/host-services";

export const INTEGRATIONS_PAGE_SIZE = 20;
export const INTEGRATION_RUNS_PAGE_SIZE = 10;

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

			return { loadRuns, loadIntegrations };
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

const listIntegrationProviders = Effect.fnUntraced(function* (scope: ApiScope) {
	const api = yield* IntegrationsApi;
	return yield* api.listProviders(scope);
});

const getIntegration = Effect.fnUntraced(function* (scope: ApiScope, integrationId: string) {
	const api = yield* IntegrationsApi;
	return yield* api.get(scope, { params: { integrationId: IntegrationId.make(integrationId) } });
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
	readonly ListedIntegrationProvider[],
	KernelHostServices
>(({ signal, hostServices }) =>
	hostServices.runtime.runPromise(listIntegrationProviders(hostServices.scope), { signal }),
);

export const integrationDetailQuery = createRyotQuery<
	string,
	ListedIntegration,
	KernelHostServices
>(({ input, signal, hostServices }) =>
	hostServices.runtime.runPromise(getIntegration(hostServices.scope, input), { signal }),
);

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
	ListedIntegration,
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
	ListedIntegration,
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
