import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class EntityProvidersApi extends Context.Service<EntityProvidersApi>()(
	"EntityProvidersApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				search: (scope: ApiScope, request: ContractRequest<"entityProviders", "search">) =>
					api.run(scope, (client) => client.entityProviders.search(request)),
				import: (scope: ApiScope, request: ContractRequest<"entityProviders", "import">) =>
					api.run(scope, (client) => client.entityProviders.import(request)),
				searchOptions: (
					scope: ApiScope,
					request: ContractRequest<"entityProviders", "searchOptions">,
				) => api.run(scope, (client) => client.entityProviders.searchOptions(request)),
				getImportResult: (
					scope: ApiScope,
					request: ContractRequest<"entityProviders", "getImportResult">,
				) => api.run(scope, (client) => client.entityProviders.getImportResult(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
