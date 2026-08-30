import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { Context, Effect, Layer } from "effect";

import { ClientPagesApi } from "#/api/client-pages";
import type { ApiScope } from "#/api/scope";

export class ClientPageFreshness extends Context.Service<ClientPageFreshness>()(
	"ClientPageFreshness",
	{
		make: Effect.gen(function* () {
			const api = yield* ClientPagesApi;
			return {
				check: (scope: ApiScope, identity: PreparedClientPage["identity"]) =>
					api
						.checkFreshness(scope, { payload: { identity } })
						.pipe(Effect.map((result) => result.current)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
