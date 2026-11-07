import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Ref, Schema } from "effect";

import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import {
	entityPopulationExecutionId,
	EntityPopulationTrigger,
} from "#modules/entities/population-trigger";
import { type DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";

import { preRegisterProviderDetails } from "./details-principal";
import { admitPopulation } from "./population-admission";
import { ProviderEntityPopulationPayload } from "./population-job";

const terminalRequest = (request: { readonly state: string }) =>
	request.state === "succeeded" || request.state === "failed" || request.state === "cancelled";

export const EntityPopulationTriggerLive = Layer.effect(
	EntityPopulationTrigger,
	Effect.gen(function* () {
		const pluginRuntime = yield* PluginRuntimeResolver;
		const sandbox = yield* ScriptExecutionService;
		const session = yield* DatabaseSession;
		const checks = yield* DomainWriteChecks;
		const requests = yield* EnrichmentRequests;
		const jobs = yield* JobQueue;

		return {
			request: (input) =>
				Effect.gen(function* () {
					const executionId = entityPopulationExecutionId(
						input.entityId,
						input.command.accountUserId,
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
					const executingUserId = input.userId ?? input.command.accountUserId ?? null;
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
							yield* checks.check(
								payload.command,
								definitionOwner(provider.pluginId),
								payload.entityScope.type === "user" ? payload.entityScope.userId : null,
								true,
							);
							return yield* admitPopulation(payload, {
								entityId: input.entityId,
								...(input.execution.retryOf ? { retryOf: input.execution.retryOf } : {}),
								...(input.execution.inputHash ? { inputHash: input.execution.inputHash } : {}),
							}).pipe(
								Effect.provideService(EnrichmentRequests, requests),
								Effect.provideService(JobQueue, jobs),
							);
						},
						Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
					);
					const command = existingPayload?.command ?? input.command;
					const admission = yield* Ref.make<null | Effect.Success<
						ReturnType<typeof retainRequest>
					>>(null);
					if (command.writeContext === null) {
						if (executingUserId === null || input.command.accountUserId === null) {
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
								accountUserId: input.command.accountUserId,
								retain: (principal) =>
									Effect.gen(function* () {
										const admitted = yield* retainRequest({
											...input.command,
											writeContext: principal,
										});
										yield* Ref.set(admission, admitted);
										if (admitted.id !== executionId || terminalRequest(admitted)) {
											return yield* registrationNotNeeded;
										}
										const retained = yield* Schema.decodeUnknownEffect(
											ProviderEntityPopulationPayload,
										)(admitted.payload).pipe(
											Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
										);
										if (retained.command.writeContext?.scriptId !== principal.scriptId) {
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
								Effect.flatMap((admitted) => Ref.set(admission, admitted)),
							),
						);
					}
					const admitted = yield* Ref.get(admission);
					return admitted !== null && !terminalRequest(admitted) && admitted.id === executionId;
				}).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
		};
	}),
);
