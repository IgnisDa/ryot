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
			saveUserSettings: (
				scope: ApiScope,
				request: ContractRequest<"plugins", "saveUserSettings">,
			) => api.run(scope, (client) => client.plugins.saveUserSettings(request)),
			resetUserSettings: (
				scope: ApiScope,
				request: ContractRequest<"plugins", "resetUserSettings">,
			) => api.run(scope, (client) => client.plugins.resetUserSettings(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
