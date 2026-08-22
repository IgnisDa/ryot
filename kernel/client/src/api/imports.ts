import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class ImportsApi extends Context.Service<ImportsApi>()("ImportsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			listSources: (scope: ApiScope) => api.run(scope, (client) => client.imports.listSources()),
			createRun: (scope: ApiScope, request: ContractRequest<"imports", "createRun">) =>
				api.run(scope, (client) => client.imports.createRun(request)),
			deleteRun: (scope: ApiScope, request: ContractRequest<"imports", "deleteRun">) =>
				api.run(scope, (client) => client.imports.deleteRun(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
