import { AuthRateLimited, AuthUnauthorized } from "@ryot/contract/auth-middleware";
import type {
	PluginRyotQLOutcome,
	PluginRyotQLRequest,
} from "@ryot/contract/modules/plugins/client";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot/contract/modules/ryotql/contract";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthenticatedApi } from "../../api/authenticated";
import type { ApiScope } from "../../api/scope";

const isExpectedFailure = Schema.is(
	Schema.Union([AuthRateLimited, AuthUnauthorized, RyotQLBadRequest, RyotQLInternalError]),
);

export class PluginQueriesService extends Context.Service<PluginQueriesService>()(
	"PluginQueriesService",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			const query = Effect.fn("PluginQueriesService.query")(function* (invocation: {
				readonly scope: ApiScope;
				readonly request: PluginRyotQLRequest;
			}) {
				const outcome = yield* api
					.run(invocation.scope, (client) =>
						client.ryotql.execute({ payload: invocation.request.document }),
					)
					.pipe(
						Effect.match({
							onSuccess: (response) => ({ outcome: "success", response }) as const,
							onFailure: (error) =>
								({
									outcome: "failure",
									reason: isExpectedFailure(error.cause) ? "query-failed" : "transport",
								}) as const,
						}),
					);
				return outcome satisfies PluginRyotQLOutcome;
			});

			return { query };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
