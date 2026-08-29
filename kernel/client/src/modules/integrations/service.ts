import { integrationImportRunsRecipe } from "@ryot-app/ryotql-recipes/import-runs";
import { integrationsRecipe } from "@ryot-app/ryotql-recipes/integrations";
import { Context, Data, Effect, Layer } from "effect";

import type { KernelRyotClient } from "#/api/ryot-client";

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
