import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class PluginInstallationsApi extends Context.Service<PluginInstallationsApi>()(
	"PluginInstallationsApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				updatePackage: (scope: ApiScope, request: ContractRequest<"plugins", "update">) =>
					api.run(scope, (client) => client.plugins.update(request)),
				uninstall: (scope: ApiScope, request: ContractRequest<"plugins", "uninstall">) =>
					api.run(scope, (client) => client.plugins.uninstall(request)),
				update: (scope: ApiScope, request: ContractRequest<"plugins", "updatePluginState">) =>
					api.run(scope, (client) => client.plugins.updatePluginState(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
