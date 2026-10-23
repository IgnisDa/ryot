import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class SavedViewsApi extends Context.Service<SavedViewsApi>()("SavedViewsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			update: (scope: ApiScope, request: ContractRequest<"savedViews", "update">) =>
				api.run(scope, (client) => client.savedViews.update(request)),
			reorder: (scope: ApiScope, request: ContractRequest<"savedViews", "reorder">) =>
				api.run(scope, (client) => client.savedViews.reorder(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
