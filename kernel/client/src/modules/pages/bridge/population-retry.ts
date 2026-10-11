import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import type {
	PluginRetryPopulationOutcome,
	PluginRetryPopulationRequest,
} from "@ryot-app/plugin-client-contract";
import { Context, Effect, Layer } from "effect";

import { EntitiesApi, isDeclaredPopulationRetryFailure } from "#/api/entities";
import type { ApiScope } from "#/api/scope";

import { hasPluginContributor, invalidRequest } from "./plugin-contributor";

export class PluginPopulationRetries extends Context.Service<PluginPopulationRetries>()(
	"PluginPopulationRetries",
	{
		make: Effect.gen(function* () {
			const api = yield* EntitiesApi;
			const outcome = (
				scope: ApiScope,
				contributors: PreparedClientPage["identity"]["contributors"],
				request: PluginRetryPopulationRequest,
			): Effect.Effect<PluginRetryPopulationOutcome> => {
				if (!hasPluginContributor(contributors, request.pluginId)) {
					return Effect.succeed(invalidRequest);
				}
				return api
					.retryPopulation(scope, {
						params: { entityId: request.entityId },
						payload: { pluginId: request.pluginId },
					})
					.pipe(
						Effect.match({
							onSuccess: ({ retried }) => ({ retried, outcome: "success" }) as const,
							onFailure: (error) =>
								({
									outcome: "failure",
									reason: isDeclaredPopulationRetryFailure(error) ? "invalid-request" : "transport",
								}) as const,
						}),
					);
			};
			return { outcome };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
