import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import {
	SandboxScriptId,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import {
	LifecycleDispatchPlan,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { EntityImportPayload, ProviderEntityImportWorkflowPayload } from "./schemas";

type ProviderResolveOperationInput = {
	readonly value: string;
	readonly userId: UserId | null;
	readonly identifierType: string;
	readonly providerId: SandboxProviderId;
	readonly accountGeneration: AccountGeneration | null;
};

export type EntityImportWorkflowOperationsValue = {
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
		const sandbox = yield* SandboxExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;

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
				const resolveScript = (
					payload.entityScope.userId
						? pluginRuntime.resolveUserDetailsScript(payload.entityScope.userId, payload.providerId)
						: pluginRuntime.resolveDetailsScript(payload.providerId)
				).pipe(
					Effect.map(({ id }) => id),
					Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
				);
				const scriptId = yield* makeActivity({
					error: SandboxRunError,
					execute: resolveScript,
					success: SandboxScriptId,
					name: `resolve-provider-details-script-${executionId}`,
				});
				return yield* sandbox.executeScript({
					scriptId,
					executionId: `${executionId}-sandbox-details`,
					input: {
						externalId: payload.externalId,
						...(existingProperties === undefined ? {} : { existingProperties }),
					},
					subject: accountGeneration
						? { type: "user", accountGeneration, userId: accountGeneration.userId }
						: { type: "system" },
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
				const resolveScript = (
					input.userId
						? pluginRuntime.resolveUserResolveScript(input.userId, input.providerId)
						: pluginRuntime.resolveResolveScript(input.providerId)
				).pipe(
					Effect.map(({ id }) => id),
					Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
				);
				const scriptId = yield* makeActivity({
					error: SandboxRunError,
					execute: resolveScript,
					success: SandboxScriptId,
					name: `resolve-provider-resolve-script-${executionId}`,
				});
				return yield* sandbox.executeScript({
					scriptId,
					executionId: `${executionId}-sandbox-resolve`,
					input: { value: input.value, identifierType: input.identifierType },
					subject: accountGeneration
						? { type: "user", accountGeneration, userId: accountGeneration.userId }
						: { type: "system" },
				});
			}).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));

		const completeProviderEntityImport = (
			payload: ProviderEntityImportWorkflowPayload,
			importedEntity: ListedEntity,
			executionId: string,
		) =>
			Effect.gen(function* () {
				const completion = {
					entityId: importedEntity.id,
					category: "change" as const,
					externalId: payload.externalId,
					providerId: payload.providerId,
					operation: "complete" as const,
					userId: payload.entityScope.userId,
					entitySchemaSlug: payload.entitySchemaSlug,
					resource: "provider-entity-import" as const,
				};
				const plan = yield* makeActivity({
					error: SandboxRunError,
					success: Schema.Array(LifecycleDispatchPlan),
					name: `plan-provider-import-completion-${executionId}`,
					execute: session
						.transaction(
							planner
								.plan({
									trigger: lifecycleTrigger(
										payload.command,
										payload.entityScope.userId,
										completion,
									),
								})
								.pipe(
									Effect.map((result) =>
										result.trigger === null ? [] : [toLifecycleDispatchPlan(result)],
									),
								),
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
			});

		return {
			completeProviderEntityImport,
			processSandbox: processSandboxEntityDetails,
			processProviderResolve: processSandboxProviderResolve,
		} satisfies EntityImportWorkflowOperationsValue;
	}),
);
