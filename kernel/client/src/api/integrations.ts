import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class IntegrationsApi extends Context.Service<IntegrationsApi>()("IntegrationsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			sync: (scope: ApiScope) => api.run(scope, (client) => client.integrations.sync()),
			create: (scope: ApiScope, request: ContractRequest<"integrations", "create">) =>
				api.run(scope, (client) => client.integrations.create(request)),
			update: (scope: ApiScope, request: ContractRequest<"integrations", "update">) =>
				api.run(scope, (client) => client.integrations.update(request)),
			delete: (scope: ApiScope, request: ContractRequest<"integrations", "delete">) =>
				api.run(scope, (client) => client.integrations.delete(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
