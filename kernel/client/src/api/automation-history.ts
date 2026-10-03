import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class AutomationHistoryApi extends Context.Service<AutomationHistoryApi>()(
	"AutomationHistoryApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				retryRun: (scope: ApiScope, request: ContractRequest<"automationHistory", "retryRun">) =>
					api.run(scope, (client) => client.automationHistory.retryRun(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
