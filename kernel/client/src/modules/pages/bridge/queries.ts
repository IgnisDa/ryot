import { stampExecutionSource } from "@ryot-app/contract/modules/ryotql/request";
import type { PluginRyotQLOutcome, PluginRyotQLRequest } from "@ryot-app/plugin-client-contract";
import { Context, Effect, Layer } from "effect";

import type { AuthenticatedApiError } from "#/api/authenticated";
import { classifyRyotQLFailure, RyotQLApi } from "#/api/ryotql";
import type { ApiScope } from "#/api/scope";

export class PluginQueriesService extends Context.Service<PluginQueriesService>()(
	"@ryot-app/kernel-client/modules/pages/bridge/queries/PluginQueriesService",
	{
		make: Effect.gen(function* () {
			const api = yield* RyotQLApi;
			const query = Effect.fn("PluginQueriesService.query")(function* (invocation: {
				readonly scope: ApiScope;
				/** The catalog namespace of the requesting document's code, which authored its inline text. */
				readonly namespace: string;
				readonly request: PluginRyotQLRequest;
			}) {
				const request = invocation.request;
				if (request.action === "page-execute" || request.action === "page-describe") {
					return { outcome: "failure", reason: "query-failed" } as const;
				}
				const payload = {
					...request.request,
					source: stampExecutionSource(invocation.namespace, request.request.source),
				};
				const program: Effect.Effect<
					Extract<PluginRyotQLOutcome, { readonly outcome: "success" }>["response"],
					AuthenticatedApiError
				> =
					request.action === "describe"
						? api.describePlugin(invocation.scope, { payload })
						: api.executePlugin(invocation.scope, { payload });
				const outcome = yield* program.pipe(
					Effect.match({
						onSuccess: (response) => ({ response, outcome: "success" }) as const,
						onFailure: (error) =>
							({ outcome: "failure", reason: classifyRyotQLFailure(error) }) as const,
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
