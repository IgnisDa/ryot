import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class AutomationsApi extends Context.Service<AutomationsApi>()(
	"@ryot-app/kernel-client/api/automations/AutomationsApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				installRule: (scope: ApiScope, request: ContractRequest<"automations", "installRule">) =>
					api.run(scope, (client) => client.automations.installRule(request)),
				activateRule: (scope: ApiScope, request: ContractRequest<"automations", "activateRule">) =>
					api.run(scope, (client) => client.automations.activateRule(request)),
				deactivateRule: (
					scope: ApiScope,
					request: ContractRequest<"automations", "deactivateRule">,
				) => api.run(scope, (client) => client.automations.deactivateRule(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
