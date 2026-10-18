import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import {
	entityPopulationExecutionId,
	EntityPopulationTrigger,
	populationRequestPin,
} from "#modules/entities/population-trigger";
import { type DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { DatabaseSession } from "#platform/db/session";

import { preRegisterProviderDetails } from "./details-principal";
import {
	ProviderEntityPopulationPayload,
	ProviderEntityPopulationWorkflow,
} from "./provider-entity-population-workflow";

const terminalRequest = (request: { readonly state: string }) =>
	request.state === "succeeded" || request.state === "failed" || request.state === "cancelled";

export const EntityPopulationTriggerLive = Layer.effect(
	EntityPopulationTrigger,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const receipts = yield* MutationReceipts.make;
		const sandbox = yield* ScriptExecutionService;
		const session = yield* DatabaseSession;
		const checks = yield* DomainWriteChecks;
		const requests = yield* EnrichmentRequests;

		return {
			request: (input) =>
				Effect.gen(function* () {
					const executionId = entityPopulationExecutionId(
						input.entityId,
						input.command.accountGeneration,
						input.execution,
					);
					const existingRequest = yield* requests.get(executionId);
					if (existingRequest && terminalRequest(existingRequest)) {
						return false;
					}
					const existingPayload = existingRequest
						? yield* Schema.decodeUnknownEffect(ProviderEntityPopulationPayload)(
								existingRequest.payload,
							)
						: null;
					const executingUserId = input.userId ?? input.command.accountGeneration?.userId ?? null;
					const provider = executingUserId
						? yield* pluginRuntime.findProviderAvailableToUser(executingUserId, input.providerId)
						: yield* pluginRuntime.findActiveProviderById(input.providerId);
					if (
						!provider ||
						provider.pluginId !== input.entitySchemaPluginId ||
						provider.rootEntitySchemaSlug !== input.entitySchemaSlug
					) {
						return false;
					}
					const retainRequest = Effect.fnUntraced(
						function* (command: DomainLifecycleCommand) {
							const payload =
								existingPayload ??
								({
									command,
									executionId,
									level: input.execution.level,
									externalId: input.externalId,
									providerId: input.providerId,
									entitySchemaSlug: input.entitySchemaSlug,
									pluginId: PluginId.make(provider.pluginId),
									mode: input.execution.mode ?? (input.execution.retryOf ? "refresh" : "ensure"),
									...(input.execution.translationLanguage
										? { translationLanguage: input.execution.translationLanguage }
										: {}),
									...(input.execution.manualRefresh ? { manualRefresh: true } : {}),
									entityScope:
										command.writeContext?.pluginRevision?.scope === "user" && input.userId
											? { type: "user", userId: input.userId }
											: { type: "global", userId: input.userId },
								} satisfies ProviderEntityPopulationPayload);
							const admitted = yield* requests.ensure({
								payload,
								language: null,
								id: executionId,
								dispatchRoot: true,
								operation: "population",
								entityId: input.entityId,
								pluginId: provider.pluginId,
								populationMode: payload.mode,
								providerId: input.providerId,
								externalId: input.externalId,
								level: input.execution.level,
								cooldown: payload.manualRefresh,
								inputHash: input.execution.inputHash,
								entitySchemaSlug: input.entitySchemaSlug,
								requester: input.command.accountGeneration,
								populationPin: populationRequestPin(command),
								workflowName: ProviderEntityPopulationWorkflow._tag,
								scopeUserId:
									payload.entityScope.type === "user" ? payload.entityScope.userId : null,
								...(input.execution.retryOf ? { retryOf: input.execution.retryOf } : {}),
							});
							if (terminalRequest(admitted)) {
								return { payload: null, request: admitted };
							}
							const admittedPayload = yield* Schema.decodeUnknownEffect(
								ProviderEntityPopulationPayload,
							)(admitted.payload);
							yield* checks.check(
								admittedPayload.command,
								definitionOwner(provider.pluginId),
								admittedPayload.entityScope.type === "user"
									? admittedPayload.entityScope.userId
									: null,
								true,
							);
							return { request: admitted, payload: admittedPayload };
						},
						Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
					);
					const command = existingPayload?.command ?? input.command;
					const retainedAdmission = yield* Ref.make<Effect.Success<
						ReturnType<typeof retainRequest>
					> | null>(null);
					if (command.writeContext === null) {
						if (executingUserId === null || input.command.accountGeneration === null) {
							return false;
						}
						const registrationNotNeeded = new SandboxRunError({
							kind: "invalid-input",
							message: "Population admission already has a retained execution",
						});
						yield* preRegisterProviderDetails(
							{ sandbox, pluginRuntime },
							{
								executionId,
								userId: executingUserId,
								pluginId: provider.pluginId,
								providerId: input.providerId,
								accountGeneration: input.command.accountGeneration,
								retain: (principal) =>
									Effect.gen(function* () {
										const admitted = yield* retainRequest({
											...input.command,
											writeContext: principal,
										});
										yield* Ref.set(retainedAdmission, admitted);
										if (
											admitted.request.id !== executionId ||
											admitted.payload === null ||
											admitted.payload.command.writeContext?.scriptId !== principal.scriptId
										) {
											return yield* registrationNotNeeded;
										}
										return undefined;
									}),
							},
						).pipe(
							Effect.catchTag("SandboxRunError", (error) =>
								error === registrationNotNeeded ? Effect.void : Effect.fail(error),
							),
						);
					} else {
						yield* session.transaction(
							retainRequest(command).pipe(
								Effect.flatMap((admitted) => Ref.set(retainedAdmission, admitted)),
							),
						);
					}
					const admitted = yield* Ref.get(retainedAdmission);
					if (!admitted?.payload) {
						return false;
					}
					yield* dispatchAdmittedWorkflow(
						receipts,
						engine,
						ProviderEntityPopulationWorkflow,
						input.command.accountGeneration,
						{ discard: true, payload: admitted.payload, executionId: admitted.request.id },
						(admission) => admission,
						(execution) =>
							execution.pipe(
								Effect.asVoid,
								Effect.tapCause((cause) =>
									Effect.logWarning("entity population enqueue failed", cause),
								),
							),
					);
					return admitted.request.id === executionId;
				}).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
		};
	}),
);
