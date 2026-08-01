import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { Database } from "#lib/infrastructure/db/service";
import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { ProviderEntityPopulationWorkflow } from "./provider-entity-population-workflow";

export const EntityPopulationTriggerLive = Layer.effect(
	EntityPopulationTrigger,
	Effect.gen(function* () {
		const database = yield* Database;
		const engine = yield* WorkflowEngine;
		const pluginRuntime = yield* PluginRuntimeResolver;

		return {
			request: (input) =>
				Effect.gen(function* () {
					if (
						input.userId &&
						!(yield* pluginRuntime.isSystemProviderAvailableToUser(input.userId, input.providerId))
					) {
						return;
					}
					const executionId = `populate-${input.entityId}`;
					yield* engine
						.execute(ProviderEntityPopulationWorkflow, {
							executionId,
							discard: true,
							payload: {
								executionId,
								mode: "ensure",
								origin: input.origin,
								userId: input.userId,
								externalId: input.externalId,
								providerId: input.providerId,
								entitySchemaSlug: input.entitySchemaSlug,
							},
						})
						.pipe(
							Effect.asVoid,
							Effect.tapCause((cause) =>
								Effect.logWarning("entity population enqueue failed", cause),
							),
						);
				}).pipe(Effect.provideService(Database, database), Effect.orDie),
		};
	}),
);
