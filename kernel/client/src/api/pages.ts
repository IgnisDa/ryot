import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class PagesApi extends Context.Service<PagesApi>()("PagesApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			prepare: (scope: ApiScope, request: ContractRequest<"pages", "prepare">) =>
				api.run(scope, (client) => client.pages.prepare(request)),
			document: (scope: ApiScope, request: ContractRequest<"pages", "document">) =>
				api.run(scope, (client) => client.pages.document(request)),
			checkFreshness: (scope: ApiScope, request: ContractRequest<"pages", "checkFreshness">) =>
				api.run(scope, (client) => client.pages.checkFreshness(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
