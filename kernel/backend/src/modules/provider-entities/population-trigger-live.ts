import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	EntityPopulationTrigger,
	entityPopulationExecutionId,
} from "#modules/entities/population-trigger";
import { DomainWriteChecks } from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { preRegisterProviderDetails } from "./details-principal";
import { ProviderEntityPopulationWorkflow } from "./provider-entity-population-workflow";

export const EntityPopulationTriggerLive = Layer.effect(
	EntityPopulationTrigger,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const receipts = yield* MutationReceipts.make;
		const sandbox = yield* SandboxExecutionService;
		const session = yield* DatabaseSession;
		const checks = yield* DomainWriteChecks;

		return {
			request: (input) =>
				Effect.gen(function* () {
					const executingUserId = input.userId ?? input.command.accountGeneration?.userId ?? null;
					const provider = executingUserId
						? yield* pluginRuntime.findProviderAvailableToUser(executingUserId, input.providerId)
						: yield* pluginRuntime.findActiveProviderById(input.providerId);
					if (
						!provider ||
						provider.pluginId !== input.entitySchemaPluginId ||
						provider.rootEntitySchemaSlug !== input.entitySchemaSlug
					) {
						return;
					}
					const executionId = entityPopulationExecutionId(
						input.entityId,
						input.command.accountGeneration,
					);
					let command = input.command;
					if (input.command.writeContext === null) {
						if (executingUserId === null || input.command.accountGeneration === null) {
							return;
						}
						const pin = yield* preRegisterProviderDetails(
							{ sandbox, pluginRuntime },
							{
								executionId,
								userId: executingUserId,
								pluginId: provider.pluginId,
								providerId: input.providerId,
								accountGeneration: input.command.accountGeneration,
							},
						);
						command = { ...input.command, writeContext: pin.principal };
					}
					yield* session.transaction(
						checks.check(
							command,
							definitionOwner(provider.pluginId),
							command.writeContext?.pluginRevision?.scope === "user" ? input.userId : null,
							true,
						),
					);
					yield* dispatchAdmittedWorkflow(
						receipts,
						engine,
						ProviderEntityPopulationWorkflow,
						input.command.accountGeneration,
						{
							executionId,
							discard: true,
							payload: {
								command,
								executionId,
								mode: "ensure",
								externalId: input.externalId,
								providerId: input.providerId,
								entitySchemaSlug: input.entitySchemaSlug,
								pluginId: PluginId.make(provider.pluginId),
								entityScope:
									command.writeContext?.pluginRevision?.scope === "user" && input.userId
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
