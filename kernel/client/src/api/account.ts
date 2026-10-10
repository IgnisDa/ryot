import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class AccountApi extends Context.Service<AccountApi>()("AccountApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			refreshAvatar: (scope: ApiScope) =>
				api.run(scope, (client) => client.account.refreshAvatar()),
			updatePreferences: (
				scope: ApiScope,
				request: ContractRequest<"account", "updatePreferences">,
			) => api.run(scope, (client) => client.account.updatePreferences(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
