import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { EntityPopulationTrigger } from "#modules/entities/population-trigger";

import { BuiltinEntityImportWorkflow } from "./workflows";

export const EntityPopulationTriggerLive = Layer.effect(
	EntityPopulationTrigger,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;

		return {
			request: (input) => {
				const executionId = `populate-${input.entityId}`;
				return engine
					.execute(BuiltinEntityImportWorkflow, {
						executionId,
						discard: true,
						payload: {
							executionId,
							userId: input.userId,
							externalId: input.externalId,
							scriptId: input.sandboxScriptId,
							entitySchemaId: input.entitySchemaId,
						},
					})
					.pipe(
						Effect.asVoid,
						Effect.catchAllCause((cause) =>
							Effect.logWarning("Failed to enqueue entity population", cause),
						),
					);
			},
		};
	}),
);
