import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { EntityPopulationTrigger } from "#modules/entities/population-trigger";

import { ProviderEntityPopulationWorkflow } from "./provider-entity-population-workflow";

export const EntityPopulationTriggerLive = Layer.effect(
	EntityPopulationTrigger,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;

		return {
			request: (input) => {
				const executionId = `populate-${input.entityId}`;
				return engine
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
						Effect.catchCause((cause) =>
							Effect.logWarning("entity population enqueue failed", cause),
						),
					);
			},
		};
	}),
);
