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

import type { AuthenticatedApiError } from "#/api/authenticated";
import { IntegrationsApi } from "#/api/integrations";
import { PublicApi } from "#/api/public";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import type { KernelHostServices } from "#/host-services";

export const INTEGRATIONS_PAGE_SIZE = 20;
export const INTEGRATION_RUNS_PAGE_SIZE = 10;

export const selectedIntegrationReadinessQuery = createRyotQuery<
	NonNullable<Parameters<typeof integrationProvidersRecipe>[0]["selected"]>,
	IntegrationProvidersPage["items"][number] | undefined,
	KernelHostServices
>(({ input, client }) =>
	Effect.gen(function* () {
		let after: string | undefined;
		do {
			const page = yield* client.data.query(
				integrationProvidersRecipe({ after, limit: 100, selected: input }),
			);
			const provider = page.items.find((item) => item.slug === input.slug);
			if (provider !== undefined) {
				return provider;
			}
			after = page.pageInfo.nextCursor ?? undefined;
		} while (after !== undefined);
		return undefined;
	}),
);

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
		make: Effect.gen(function* () {
			const publicApi = yield* PublicApi;
			const loadIntegrations = Effect.fn("IntegrationsService.loadIntegrations")(function* (
				client: IntegrationsClient,
				input: { readonly limit: number },
			) {
				return yield* client.data
					.query(integrationsRecipe({ limit: input.limit }))
					.pipe(Effect.mapError((cause) => new IntegrationsLoadError({ cause, stage: "list" })));
			});
			const loadRuns = Effect.fn("IntegrationsService.loadRuns")(function* (
				client: IntegrationsClient,
				input: { readonly limit: number; readonly integrationId: string },
			) {
				return yield* client.data
					.query(
						integrationImportRunsRecipe({ limit: input.limit, integrationId: input.integrationId }),
					)
					.pipe(Effect.mapError((cause) => new IntegrationsLoadError({ cause, stage: "runs" })));
			});

			const loadProviders = Effect.fn("IntegrationsService.loadProviders")(function* (
				client: IntegrationsClient,
				serverUrl: ApiScope["serverUrl"],
			) {
				const config = yield* publicApi
					.getSystemConfig(serverUrl)
					.pipe(Effect.orElseSucceed(() => null));
				const providers: IntegrationProviderItem[] = [];
				let after: string | undefined | null;
				do {
					const page = yield* client.data
						.query(integrationProvidersRecipe({ limit: 100, after: after ?? undefined }))
						.pipe(Effect.mapError((cause) => new IntegrationsLoadError({ cause, stage: "list" })));
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
				const result = yield* client.data
					.query(integrationRecipe({ id }))
					.pipe(Effect.mapError((cause) => new IntegrationsLoadError({ cause, stage: "list" })));
				if (Option.isNone(result)) {
					return Option.none();
				}
				const { webhookToken, ...integration } = result.value;
				if (webhookToken === null) {
					return Option.some(integration);
				}
				const config = yield* publicApi.getSystemConfig(serverUrl);
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

export const getIntegration = Effect.fnUntraced(function* (
	client: IntegrationsClient,
	serverUrl: ApiScope["serverUrl"],
	integrationId: string,
) {
	const service = yield* IntegrationsService;
	return yield* service.loadIntegration(client, serverUrl, integrationId);
});

export const integrationsQuery = createRyotQuery<
	number,
	IntegrationList,
	KernelHostServices,
	IntegrationsLoadError
>(({ input, client, hostServices }) =>
	hostServices.runtime.runSync(IntegrationsService).loadIntegrations(client, { limit: input }),
);

export const integrationRunsQuery = createRyotQuery<
	string,
	ImportRunList,
	KernelHostServices,
	IntegrationsLoadError
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(IntegrationsService)
		.loadRuns(client, { integrationId: input, limit: INTEGRATION_RUNS_PAGE_SIZE }),
);

export const integrationProvidersQuery = createRyotQuery<
	void,
	readonly IntegrationProviderItem[],
	KernelHostServices,
	IntegrationsLoadError
>(({ client, hostServices }) =>
	hostServices.runtime
		.runSync(IntegrationsService)
		.loadProviders(client, hostServices.scope.serverUrl)
		.pipe(
			Effect.mapError((cause) =>
				cause instanceof IntegrationsLoadError
					? cause
					: new IntegrationsLoadError({ cause, stage: "list" }),
			),
		),
);

export const integrationDetailQuery = createRyotQuery<
	string,
	IntegrationClientDetail | undefined,
	KernelHostServices,
	IntegrationsLoadError
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(IntegrationsService)
		.loadIntegration(client, hostServices.scope.serverUrl, input)
		.pipe(
			Effect.map(Option.getOrUndefined),
			Effect.mapError((cause) =>
				cause instanceof IntegrationsLoadError
					? cause
					: new IntegrationsLoadError({ cause, stage: "list" }),
			),
		),
);

export const syncIntegrationsMutation = createRyotMutation<
	void,
	ContractSuccess<"integrations", "sync">,
	KernelHostServices,
	AuthenticatedApiError
>(({ client, hostServices }) =>
	hostServices.runtime
		.runSync(IntegrationsApi)
		.sync(hostServices.scope)
		.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
);

export const createIntegrationMutation = createRyotMutation<
	CreateIntegrationBody,
	ContractSuccess<"integrations", "create">,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(IntegrationsApi)
		.create(hostServices.scope, { payload: input })
		.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
);

export const updateIntegrationMutation = createRyotMutation<
	{ readonly id: string; readonly payload: UpdateIntegrationBody },
	ContractSuccess<"integrations", "update">,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(IntegrationsApi)
		.update(hostServices.scope, {
			payload: input.payload,
			params: { integrationId: IntegrationId.make(input.id) },
		})
		.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
);

export const deleteIntegrationMutation = createRyotMutation<
	string,
	ContractSuccess<"integrations", "delete">,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(IntegrationsApi)
		.delete(hostServices.scope, { params: { integrationId: IntegrationId.make(input) } })
		.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
);
