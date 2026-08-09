import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type { ContractRequest } from "@ryot-app/contract/client";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot-app/contract/modules/ryotql/contract";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

const isDeclaredFailure = Schema.is(
	Schema.Union([AuthRateLimited, AuthUnauthorized, RyotQLBadRequest, RyotQLInternalError]),
);

export const classifyRyotQLFailure = (error: unknown) =>
	error instanceof AuthenticatedApiError && isDeclaredFailure(error.cause)
		? "query-failed"
		: "transport";

export class RyotQLApi extends Context.Service<RyotQLApi>()("RyotQLApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			execute: (scope: ApiScope, request: ContractRequest<"ryotql", "execute">) =>
				api.run(scope, (client) => client.ryotql.execute(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
