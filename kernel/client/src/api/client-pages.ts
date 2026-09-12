import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class ClientPagesApi extends Context.Service<ClientPagesApi>()("ClientPagesApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			prepare: (scope: ApiScope, request: ContractRequest<"clientPages", "prepare">) =>
				api.run(scope, (client) => client.clientPages.prepare(request)),
			checkFreshness: (
				scope: ApiScope,
				request: ContractRequest<"clientPages", "checkFreshness">,
			) => api.run(scope, (client) => client.clientPages.checkFreshness(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
