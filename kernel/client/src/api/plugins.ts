import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class PluginsApi extends Context.Service<PluginsApi>()("PluginsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			invoke: (scope: ApiScope, request: ContractRequest<"plugins", "invoke">) =>
				api.run(scope, (client) => client.plugins.invoke(request)),
			renewArtifactSession: (
				scope: ApiScope,
				request: ContractRequest<"plugins", "renewArtifactSession">,
			) => api.run(scope, (client) => client.plugins.renewArtifactSession(request)),
			revokeArtifactSession: (
				scope: ApiScope,
				request: ContractRequest<"plugins", "revokeArtifactSession">,
			) => api.run(scope, (client) => client.plugins.revokeArtifactSession(request)),
			createArtifactSession: (
				scope: ApiScope,
				request: ContractRequest<"plugins", "createArtifactSession">,
			) => api.run(scope, (client) => client.plugins.createArtifactSession(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
