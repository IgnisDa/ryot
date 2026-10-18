import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import type {
	PluginEnrichmentOutcome,
	PluginEnrichmentRequest,
} from "@ryot-app/plugin-client-contract";
import { Context, Effect, Layer } from "effect";

import { EntitiesApi, isDeclaredEnrichmentFailure } from "#/api/entities";
import type { ApiScope } from "#/api/scope";

import { hasPluginContributor, invalidRequest } from "./plugin-contributor";

export class PluginEnrichment extends Context.Service<PluginEnrichment>()("PluginEnrichment", {
	make: Effect.gen(function* () {
		const api = yield* EntitiesApi;
		const outcome = (
			scope: ApiScope,
			contributors: PreparedClientPage["identity"]["contributors"],
			request: PluginEnrichmentRequest,
		): Effect.Effect<PluginEnrichmentOutcome> => {
			if (!hasPluginContributor(contributors, request.pluginId)) {
				return Effect.succeed(invalidRequest);
			}
			return api
				.requestEnrichment(scope, {
					params: { entityId: request.entityId },
					payload: {
						action: request.action,
						pluginId: request.pluginId,
						operation: request.operation,
						idempotencyKey: request.idempotencyKey,
					},
				})
				.pipe(
					Effect.match({
						onSuccess: (result) => ({ ...result, outcome: "success" }) as const,
						onFailure: (error) =>
							({
								outcome: "failure",
								reason: isDeclaredEnrichmentFailure(error) ? "invalid-request" : "transport",
							}) as const,
					}),
				);
		};
		return { outcome };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
