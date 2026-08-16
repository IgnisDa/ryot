import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class UserSettingsApi extends Context.Service<UserSettingsApi>()("UserSettingsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			get: (scope: ApiScope) => api.run(scope, (client) => client.userSettings.get()),
			refreshAvatar: (scope: ApiScope) =>
				api.run(scope, (client) => client.userSettings.refreshAvatar()),
			updatePreferences: (
				scope: ApiScope,
				request: ContractRequest<"userSettings", "updatePreferences">,
			) => api.run(scope, (client) => client.userSettings.updatePreferences(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
