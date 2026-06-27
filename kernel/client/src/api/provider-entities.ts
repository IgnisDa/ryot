import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class ProviderEntitiesApi extends Context.Service<ProviderEntitiesApi>()(
	"ProviderEntitiesApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				search: (scope: ApiScope, request: ContractRequest<"providerEntities", "search">) =>
					api.run(scope, (client) => client.providerEntities.search(request)),
				import: (scope: ApiScope, request: ContractRequest<"providerEntities", "import">) =>
					api.run(scope, (client) => client.providerEntities.import(request)),
				searchOptions: (
					scope: ApiScope,
					request: ContractRequest<"providerEntities", "searchOptions">,
				) => api.run(scope, (client) => client.providerEntities.searchOptions(request)),
				getImportResult: (
					scope: ApiScope,
					request: ContractRequest<"providerEntities", "getImportResult">,
				) => api.run(scope, (client) => client.providerEntities.getImportResult(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
