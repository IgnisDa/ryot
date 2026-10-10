import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class OAuthConnectionsApi extends Context.Service<OAuthConnectionsApi>()(
	"OAuthConnectionsApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				create: (scope: ApiScope, request: ContractRequest<"oauthConnections", "create">) =>
					api.run(scope, (client) => client.oauthConnections.create(request)),
				status: (scope: ApiScope, request: ContractRequest<"oauthConnections", "status">) =>
					api.run(scope, (client) => client.oauthConnections.status(request)),
				complete: (scope: ApiScope, request: ContractRequest<"oauthConnections", "complete">) =>
					api.run(scope, (client) => client.oauthConnections.complete(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
