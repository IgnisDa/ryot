import type {
	ImportEntityBody,
	SearchProviderEntitiesBody,
} from "@ryot-app/contract/modules/provider-entities/schemas";
import type { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { providerEntityLinksRecipe } from "@ryot-app/ryotql-recipes/provider-entity-links";
import { providerSearchRecipe } from "@ryot-app/ryotql-recipes/provider-search";
import type { ProviderSearchResult } from "@ryot-app/ryotql-recipes/provider-search";
import { Context, Data, Effect, Layer } from "effect";

import { ProviderEntitiesApi } from "#/api/provider-entities";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";

type ProviderAddClient = Pick<KernelRyotClient, "data">;

export type ProviderSearchSummary = ProviderSearchResult["items"][number];

export class ProviderAddLoadError extends Data.TaggedError("ProviderAddLoadError")<{
	readonly cause: unknown;
	readonly stage: "providers" | "links" | "options" | "search" | "import";
}> {}

export class ProviderAddService extends Context.Service<ProviderAddService>()(
	"ProviderAddService",
	{
		make: Effect.gen(function* () {
			const api = yield* ProviderEntitiesApi;
			const loadProviders = Effect.fn("ProviderAddService.loadProviders")(function* (
				client: ProviderAddClient,
				entitySchemaSlug: EntitySchemaSlug,
			) {
				return yield* Effect.tryPromise({
					catch: (cause) => new ProviderAddLoadError({ cause, stage: "providers" }),
					try: (signal) =>
						client.data.query(providerSearchRecipe({ rootEntitySchemaSlug: entitySchemaSlug }), {
							signal,
						}),
				});
			});
			const loadEntityLinks = Effect.fn("ProviderAddService.loadEntityLinks")(function* (
				client: ProviderAddClient,
				input: {
					readonly providerId: SandboxProviderId;
					readonly entitySchemaSlug: EntitySchemaSlug;
					readonly externalIds: readonly [string, ...string[]];
				},
			) {
				return yield* Effect.tryPromise({
					catch: (cause) => new ProviderAddLoadError({ cause, stage: "links" }),
					try: (signal) => client.data.query(providerEntityLinksRecipe(input), { signal }),
				});
			});
			const loadSearchOptions = Effect.fn("ProviderAddService.loadSearchOptions")(function* (
				scope: ApiScope,
				providerId: SandboxProviderId,
			) {
				return yield* api
					.searchOptions(scope, { payload: { providerId } })
					.pipe(
						Effect.mapError(
							(error) => new ProviderAddLoadError({ cause: error.cause, stage: "options" }),
						),
					);
			});
			const search = Effect.fn("ProviderAddService.search")(function* (
				scope: ApiScope,
				payload: SearchProviderEntitiesBody,
			) {
				return yield* api
					.search(scope, { payload })
					.pipe(
						Effect.mapError(
							(error) => new ProviderAddLoadError({ cause: error.cause, stage: "search" }),
						),
					);
			});
			const startImport = Effect.fn("ProviderAddService.startImport")(function* (
				scope: ApiScope,
				payload: ImportEntityBody,
			) {
				return yield* api
					.import(scope, { payload })
					.pipe(
						Effect.mapError(
							(error) => new ProviderAddLoadError({ cause: error.cause, stage: "import" }),
						),
					);
			});
			const pollImport = Effect.fn("ProviderAddService.pollImport")(function* (
				scope: ApiScope,
				jobId: string,
			) {
				return yield* api
					.getImportResult(scope, { params: { jobId } })
					.pipe(
						Effect.mapError(
							(error) => new ProviderAddLoadError({ cause: error.cause, stage: "import" }),
						),
					);
			});

			return {
				search,
				pollImport,
				startImport,
				loadProviders,
				loadEntityLinks,
				loadSearchOptions,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
