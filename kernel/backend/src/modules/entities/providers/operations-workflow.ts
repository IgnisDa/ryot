import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	LifecycleDispatchPlan,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import { DomainWriteChecks } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import type { SandboxExecutionResult } from "#modules/scripts/executions/result";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { DatabaseSession } from "#platform/db/session";
import { makeActivity } from "#platform/workflow/scope";

import { preRegisterProviderDetails } from "./details-principal";
import { makeProviderExecutionReads } from "./execution-reads";
import type { EntityImportPayload, ProviderEntityImportWorkflowPayload } from "./schemas";

type ProviderResolveOperationInput = {
	readonly value: string;
	readonly lane: ExecutionLane;
	readonly userId: UserId | null;
	readonly identifierType: string;
	readonly providerId: SandboxProviderId;
	readonly accountGeneration: AccountGeneration | null;
	readonly writeContext: ScriptExecutionPrincipal | null;
};

type EntityImportWorkflowOperationsValue = {
	processSandbox: (
		payload: EntityImportPayload,
		executionId: string,
		existingProperties?: unknown,
	) => Effect.Effect<SandboxExecutionResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
	processProviderResolve: (
		input: ProviderResolveOperationInput,
		executionId: string,
	) => Effect.Effect<SandboxExecutionResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
	completeProviderEntityImport: (
		payload: ProviderEntityImportWorkflowPayload,
		importedEntity: ListedEntity,
		executionId: string,
	) => Effect.Effect<void, SandboxRunError, WorkflowEngine | WorkflowInstance>;
	preRegisterProviderImport: (
		input: {
			readonly userId: UserId;
			readonly pluginId: string;
			readonly providerId: SandboxProviderId;
			readonly accountGeneration: AccountGeneration | null;
		},
		executionId: string,
	) => Effect.Effect<ScriptExecutionPrincipal, SandboxRunError, WorkflowEngine | WorkflowInstance>;
};

/** @effect-expect-leaking WorkflowEngine | WorkflowInstance */
export class EntityImportWorkflowOperations extends Context.Service<
	EntityImportWorkflowOperations,
	EntityImportWorkflowOperationsValue
>()("EntityImportWorkflowOperations") {}

export const EntityImportWorkflowOperationsLive = Layer.effect(
	EntityImportWorkflowOperations,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const planner = yield* LifecyclePlanner;
		const execution = yield* LifecycleExecution;
		const sandbox = yield* ScriptExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const writes = yield* DomainWriteChecks;
		const reads = makeProviderExecutionReads(session);

		const resolvePinnedProviderScript = Effect.fnUntraced(function* (input: {
			userId: UserId | null;
			providerId: SandboxProviderId;
			operation: "details" | "resolve";
			command: Parameters<typeof writes.check>[0];
			pluginRevision: { id: string; revisionId: string };
		}) {
			const owner = definitionOwner(input.pluginRevision.id);
			const pin = yield* writes
				.check(input.command, owner, input.userId)
				.pipe(Effect.mapError((error) => toSandboxRunError(error, "invalid-input")));
			const provider = yield* writes
				.checkProvider(input.providerId, owner)
				.pipe(Effect.mapError((error) => toSandboxRunError(error, "invalid-input")));
			const providers = pin
				? yield* reads
						.findRevisionProviders(pin.id)
						.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")))
				: undefined;
			const slug = providers?.find(({ slug: providerSlug }) => providerSlug === provider.slug)
				?.operations[input.operation];
			const script = slug
				? yield* reads
						.findRevisionScript(input.pluginRevision.revisionId, slug)
						.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")))
				: null;
			if (
				!script ||
				script.providerId !== input.providerId ||
				script.metadata.kind !== "provider"
			) {
				return yield* new SandboxRunError({
					kind: "missing-artifact",
					message: `Pinned provider ${input.operation} script is unavailable`,
				});
			}
			return script;
		});

		const processSandboxEntityDetails = (
			payload: EntityImportPayload,
			executionId: string,
			existingProperties?: unknown,
		) =>
			Effect.gen(function* () {
				const accountGeneration = payload.command.accountGeneration;
				if (payload.entityScope.userId !== null && accountGeneration === null) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: "Provider account generation is missing",
					});
				}
				const principal = payload.command.writeContext;
				if (!principal?.pluginRevision || principal.pluginRevision.id !== payload.pluginId) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: "Provider details require the admitted plugin pin",
					});
				}
				const script = yield* resolvePinnedProviderScript({
					operation: "details",
					command: payload.command,
					providerId: payload.providerId,
					pluginRevision: principal.pluginRevision,
					userId: payload.entityScope.type === "user" ? payload.entityScope.userId : null,
				});
				return yield* sandbox.executeScript({
					scriptId: script.id,
					subject: principal.subject,
					lane: payload.command.causation.lane,
					pluginRevision: principal.pluginRevision,
					executionId: `${executionId}-sandbox-details`,
					input: {
						externalId: payload.externalId,
						...(existingProperties === undefined ? {} : { existingProperties }),
					},
				});
			}).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));

		const processSandboxProviderResolve = (
			input: ProviderResolveOperationInput,
			executionId: string,
		) =>
			Effect.gen(function* () {
				const accountGeneration = input.accountGeneration;
				if (input.userId !== null && accountGeneration === null) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: "Provider account generation is missing",
					});
				}
				const principal = yield* makeActivity({
					error: SandboxRunError,
					success: ScriptExecutionPrincipal,
					name: `resolve-provider-resolve-script-${executionId}`,
					execute: Effect.gen(function* () {
						const caller = input.writeContext;
						if (caller?.pluginRevision) {
							const script = yield* resolvePinnedProviderScript({
								operation: "resolve",
								userId: input.userId,
								providerId: input.providerId,
								command: { writeContext: caller },
								pluginRevision: caller.pluginRevision,
							});
							return yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
								...caller,
								scriptId: script.id,
								scriptSlug: script.slug,
								metadata: script.metadata,
								providerId: input.providerId,
								contentHash: script.contentHash,
							}).pipe(Effect.mapError((error) => toSandboxRunError(error, "invalid-input")));
						}
						const executingUserId = input.userId;
						if (executingUserId === null || accountGeneration === null) {
							return yield* new SandboxRunError({
								kind: "invalid-input",
								message: "System provider resolution requires a persisted plugin principal",
							});
						}
						return yield* Effect.gen(function* () {
							const provider = yield* pluginRuntime.findProviderAvailableToUser(
								executingUserId,
								input.providerId,
							);
							if (!provider) {
								return yield* new SandboxRunError({
									kind: "invalid-input",
									message: "Provider resolution target is unavailable",
								});
							}
							const script = yield* pluginRuntime
								.resolveUserResolveScript(executingUserId, input.providerId)
								.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
							const pin = yield* sandbox.preRegisterPluginWorkflow({
								executingUserId,
								accountGeneration,
								scriptId: script.id,
								pluginId: provider.pluginId,
								executionId: `${executionId}-sandbox-resolve`,
							});
							return pin.principal;
						}).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
					}),
				});
				return yield* sandbox.executeScript({
					scriptId: principal.scriptId,
					...(principal.pluginRevision ? { pluginRevision: principal.pluginRevision } : {}),
					lane: input.lane,
					subject: principal.subject,
					executionId: `${executionId}-sandbox-resolve`,
					input: { value: input.value, identifierType: input.identifierType },
				});
			}).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));

		const completeProviderEntityImport = (
			payload: ProviderEntityImportWorkflowPayload,
			importedEntity: ListedEntity,
			executionId: string,
		) =>
			Effect.gen(function* () {
				if (
					importedEntity.entitySchemaPluginId !== payload.pluginId ||
					importedEntity.entitySchemaSlug !== payload.entitySchemaSlug ||
					importedEntity.providerId !== payload.providerId
				) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: "Provider completion does not match the imported entity owner or provenance",
					});
				}
				const completion = {
					entityId: importedEntity.id,
					category: "change" as const,
					externalId: payload.externalId,
					providerId: payload.providerId,
					operation: "complete" as const,
					userId: payload.entityScope.userId,
					entitySchemaSlug: payload.entitySchemaSlug,
					resource: "provider-entity-import" as const,
					entitySchemaPluginId: importedEntity.entitySchemaPluginId,
				};
				const plan = yield* makeActivity({
					error: SandboxRunError,
					success: Schema.Array(LifecycleDispatchPlan),
					name: `plan-provider-import-completion-${executionId}`,
					execute: session
						.transaction(
							Effect.gen(function* () {
								yield* writes.check(
									payload.command,
									definitionOwner(importedEntity.entitySchemaPluginId),
									payload.entityScope.type === "user" ? payload.entityScope.userId : null,
									true,
								);
								const result = yield* planner.plan({
									trigger: lifecycleTrigger(
										payload.command,
										payload.entityScope.userId,
										completion,
									),
								});
								return result.trigger === null ? [] : [toLifecycleDispatchPlan(result)];
							}),
						)
						.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
				});
				const warnings = yield* execution
					.dispatch(plan)
					.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
				if (warnings.length > 0) {
					yield* Effect.logWarning("provider import completed with automation warnings").pipe(
						Effect.annotateLogs({
							warningCount: warnings.length,
							warnings: warnings.slice(0, 100),
						}),
					);
				}
				return yield* Effect.void;
			});

		const preRegisterProviderImport: EntityImportWorkflowOperationsValue["preRegisterProviderImport"] =
			(input, executionId) =>
				makeActivity({
					error: SandboxRunError,
					success: ScriptExecutionPrincipal,
					name: `pre-register-provider-import-${executionId}`,
					execute: Effect.gen(function* () {
						if (input.accountGeneration === null) {
							return yield* new SandboxRunError({
								kind: "invalid-input",
								message: "Provider account generation is missing",
							});
						}
						const pin = yield* preRegisterProviderDetails(
							{ sandbox, pluginRuntime },
							{ ...input, executionId, accountGeneration: input.accountGeneration },
						);
						return pin.principal;
					}).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
				});

		return {
			preRegisterProviderImport,
			completeProviderEntityImport,
			processSandbox: processSandboxEntityDetails,
			processProviderResolve: processSandboxProviderResolve,
		} satisfies EntityImportWorkflowOperationsValue;
	}),
);
