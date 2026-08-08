import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { AutomationOccurrenceId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { Context, Effect, Layer, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { Database } from "#lib/infrastructure/db/service";
import { AutomationsService } from "#modules/automations/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { EntityImportPayload } from "./schemas";

const ResolvedProviderEntityImportAutomation = Schema.Struct({
	ruleId: Schema.String,
	sandboxScriptId: SandboxScriptId,
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
			Effect.mapError(toSandboxRunError),
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
	}).pipe(Effect.mapError(toSandboxRunError));

const runProviderImportAutomations = (
	payload: EntityImportPayload,
	importedEntity: ListedEntity,
	executionId: string,
) =>
	Effect.gen(function* () {
		const sandbox = yield* SandboxExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const automations = yield* Activity.make({
			error: SandboxRunError,
			name: `resolve-provider-import-automations-${executionId}`,
			success: Schema.Array(ResolvedProviderEntityImportAutomation),
			execute: pluginRuntime
				.listProviderEntityImportAutomations(payload.entityScope.userId, payload.entitySchemaSlug)
				.pipe(Effect.mapError(toSandboxRunError)),
		});
		if (automations.length > 0 && !payload.entityScope.userId) {
			return yield* new SandboxRunError({
				message: "Provider import automations require a user subject",
			});
		}
		if (payload.entityScope.userId) {
			const automationService = yield* AutomationsService;
			const occurrenceId = AutomationOccurrenceId.make(executionId);
			yield* automationService
				.recordOccurrence({
					signalId: null,
					id: occurrenceId,
					population: null,
					operation: "create",
					origin: { kind: "import" },
					recordId: importedEntity.id,
					userId: payload.entityScope.userId,
					occurredAt: importedEntity.updatedAt,
					sourceKind: "provider-entity-import",
					source: {
						entityId: importedEntity.id,
						kind: "provider-entity-import",
						externalId: payload.externalId,
						providerId: payload.providerId,
						entitySchemaSlug: payload.entitySchemaSlug,
					},
				})
				.pipe(Effect.mapError(toSandboxRunError));
			for (const [index, automation] of automations.entries()) {
				const hookExecutionId = `${executionId}-provider-import-automation-${index}`;
				const context = {
					automation: {
						occurrenceId,
						operation: "create",
						ruleId: automation.ruleId,
						origin: { kind: "import" },
						occurredAt: importedEntity.updatedAt,
						source: {
							entityId: importedEntity.id,
							kind: "provider-entity-import",
							externalId: payload.externalId,
							providerId: payload.providerId,
							entitySchemaSlug: payload.entitySchemaSlug,
						},
					},
				} satisfies AutomationInput;
				const result = yield* sandbox
					.executeScript({
						input: context,
						executionId: hookExecutionId,
						scriptId: automation.sandboxScriptId,
						subject: {
							type: "user",
							userId: payload.entityScope.userId,
							automationOccurrenceId: occurrenceId,
						},
					})
					.pipe(Effect.mapError(toSandboxRunError));
				if (result.error) {
					return yield* new SandboxRunError({ message: result.error.message });
				}
			}
		}
		return undefined;
	});

export type EntityImportWorkflowOperationsValue = {
	processSandbox: (
		payload: EntityImportPayload,
		executionId: string,
	) => Effect.Effect<SandboxExecutionResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
	runProviderImportAutomations: (
		payload: EntityImportPayload,
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
		const automations = yield* AutomationsService;
		const sandbox = yield* SandboxExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		return {
			processSandbox: (payload, executionId) =>
				processSandboxEntityDetails(payload, executionId).pipe(
					Effect.provideService(Database, database),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(SandboxExecutionService, sandbox),
				),
			runProviderImportAutomations: (payload, importedEntity, executionId) =>
				runProviderImportAutomations(payload, importedEntity, executionId).pipe(
					Effect.provideService(Database, database),
					Effect.provideService(AutomationsService, automations),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(SandboxExecutionService, sandbox),
				),
		} satisfies EntityImportWorkflowOperationsValue;
	}),
);
