import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import {
	AutomationRun,
	AutomationTrigger,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { EntityImportPayload, ProviderEntityImportWorkflowPayload } from "./schemas";

const ProviderImportCompletionPlan = Schema.Struct({
	trigger: AutomationTrigger,
	runs: Schema.Array(AutomationRun),
});
const processSandboxEntityDetails = (payload: EntityImportPayload, executionId: string) =>
	Effect.gen(function* () {
		const sandbox = yield* SandboxExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const resolveScript = (
			payload.entityScope.userId
				? pluginRuntime.resolveUserDetailsScript(payload.entityScope.userId, payload.providerId)
				: pluginRuntime.resolveDetailsScript(payload.providerId)
		).pipe(
			Effect.map(({ id }) => id),
			Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
		);
		const scriptId = yield* Activity.make({
			error: SandboxRunError,
			execute: resolveScript,
			success: SandboxScriptId,
			name: `resolve-provider-details-script-${executionId}`,
		});
		return yield* sandbox.executeScript({
			scriptId,
			input: { externalId: payload.externalId },
			executionId: `${executionId}-sandbox-details`,
			subject: payload.entityScope.userId
				? { type: "user", userId: payload.entityScope.userId }
				: { type: "system" },
		});
	}).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));

export const completeProviderEntityImport = (
	payload: ProviderEntityImportWorkflowPayload,
	importedEntity: ListedEntity,
	executionId: string,
) =>
	Effect.gen(function* () {
		const database = yield* Database;
		const planner = yield* LifecyclePlanner;
		const execution = yield* LifecycleExecution;
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
		const plan = yield* Activity.make({
			error: SandboxRunError,
			success: ProviderImportCompletionPlan,
			name: `plan-provider-import-completion-${executionId}`,
			execute: database
				.transaction((transaction) =>
					planner
						.plan({
							trigger: lifecycleTrigger(payload.command, payload.entityScope.userId, completion),
						})
						.pipe(
							Effect.provideService(Database, transaction),
							Effect.map(({ runs, trigger }) => ({ runs, trigger })),
						),
				)
				.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
		});
		const warnings: AutomationWarning[] = [];
		if (plan.trigger.blockedReason?.hasRequiredHooks) {
			warnings.push({ ...plan.trigger.blockedReason, triggerId: plan.trigger.id });
		}
		warnings.push(
			...(yield* execution
				.after({ runs: plan.runs, triggerId: plan.trigger.id })
				.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")))),
		);
		if (warnings.length > 0) {
			yield* Effect.logWarning("provider import completed with automation warnings").pipe(
				Effect.annotateLogs({ warningCount: warnings.length, warnings: warnings.slice(0, 100) }),
			);
		}
	});

export type EntityImportWorkflowOperationsValue = {
	processSandbox: (
		payload: EntityImportPayload,
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
		const database = yield* Database;
		const planner = yield* LifecyclePlanner;
		const execution = yield* LifecycleExecution;
		const sandbox = yield* SandboxExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		return {
			processSandbox: (payload, executionId) =>
				processSandboxEntityDetails(payload, executionId).pipe(
					Effect.provideService(Database, database),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(SandboxExecutionService, sandbox),
				),
			completeProviderEntityImport: (payload, importedEntity, executionId) =>
				completeProviderEntityImport(payload, importedEntity, executionId).pipe(
					Effect.provideService(Database, database),
					Effect.provideService(LifecyclePlanner, planner),
					Effect.provideService(LifecycleExecution, execution),
				),
		} satisfies EntityImportWorkflowOperationsValue;
	}),
);
