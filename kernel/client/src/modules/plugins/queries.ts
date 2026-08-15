import type { PluginRyotQLOutcome, PluginRyotQLRequest } from "@ryot-app/client-plugin-contract";
import { Context, Effect, Layer } from "effect";

import { classifyRyotQLFailure, RyotQLApi } from "#/api/ryotql";
import type { ApiScope } from "#/api/scope";

export class PluginQueriesService extends Context.Service<PluginQueriesService>()(
	"PluginQueriesService",
	{
		make: Effect.gen(function* () {
			const api = yield* RyotQLApi;
			const query = Effect.fn("PluginQueriesService.query")(function* (invocation: {
				readonly scope: ApiScope;
				readonly request: PluginRyotQLRequest;
			}) {
				const outcome = yield* api
					.execute(invocation.scope, { payload: invocation.request.document })
					.pipe(
						Effect.match({
							onSuccess: (response) => ({ outcome: "success", response }) as const,
							onFailure: (error) =>
								({
									outcome: "failure",
									reason: classifyRyotQLFailure(error),
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
