import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type { ContractRequest } from "@ryot-app/contract/client";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot-app/contract/modules/ryotql/contract";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

const isQueryFailure = Schema.is(Schema.Union([RyotQLBadRequest, RyotQLInternalError]));

const isAuthenticationFailure = Schema.is(Schema.Union([AuthRateLimited, AuthUnauthorized]));

export const classifyRyotQLCause = (
	cause: unknown,
	isAccessFailure: (cause: unknown) => boolean,
) => (isQueryFailure(cause) || isAccessFailure(cause) ? "query-failed" : "transport");

export const classifyRyotQLFailure = (error: unknown) =>
	error instanceof AuthenticatedApiError
		? classifyRyotQLCause(error.cause, isAuthenticationFailure)
		: "transport";

export class RyotQLApi extends Context.Service<RyotQLApi>()(
	"@ryot-app/kernel-client/api/ryotql/RyotQLApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				execute: (scope: ApiScope, request: ContractRequest<"ryotql", "execute">) =>
					api.run(scope, (client) => client.ryotql.execute(request)),
				executePlugin: (scope: ApiScope, request: ContractRequest<"ryotql", "executePlugin">) =>
					api.run(scope, (client) => client.ryotql.executePlugin(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
