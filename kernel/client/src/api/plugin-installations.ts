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
				update: (scope: ApiScope, request: ContractRequest<"plugins", "updatePluginState">) =>
					api.run(scope, (client) => client.plugins.updatePluginState(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
