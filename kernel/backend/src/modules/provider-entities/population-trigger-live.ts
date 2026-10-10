import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import {
	EntityPopulationTrigger,
	entityPopulationExecutionId,
} from "#modules/entities/population-trigger";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { ProviderEntityPopulationWorkflow } from "./provider-entity-population-workflow";

export const EntityPopulationTriggerLive = Layer.effect(
	EntityPopulationTrigger,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const receipts = yield* MutationReceipts.make;

		return {
			request: (input) =>
				Effect.gen(function* () {
					const provider = input.userId
						? yield* pluginRuntime.findProviderAvailableToUser(input.userId, input.providerId)
						: null;
					if (input.userId && !provider) {
						return;
					}
					const executionId = entityPopulationExecutionId(
						input.entityId,
						input.command.accountGeneration,
					);
					yield* dispatchAdmittedWorkflow(
						receipts,
						engine,
						ProviderEntityPopulationWorkflow.forLane(input.command.causation.lane),
						input.command.accountGeneration,
						{
							executionId,
							discard: true,
							payload: {
								executionId,
								mode: "ensure",
								command: input.command,
								externalId: input.externalId,
								providerId: input.providerId,
								entitySchemaSlug: input.entitySchemaSlug,
								entityScope:
									provider?.pluginScope === "user" && input.userId
										? { type: "user", userId: input.userId }
										: { type: "global", userId: input.userId },
							},
						},
						(admission) => admission,
						(execution) =>
							execution.pipe(
								Effect.asVoid,
								Effect.tapCause((cause) =>
									Effect.logWarning("entity population enqueue failed", cause),
								),
							),
					);
				}).pipe(Effect.orDie),
		};
	}),
);
