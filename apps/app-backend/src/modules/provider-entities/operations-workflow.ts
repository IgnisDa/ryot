import { SandboxRunError, toSandboxRunError } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Context, Effect, Layer, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { Database } from "#lib/infrastructure/db/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { EntityImportPayload } from "./schemas";

const ResolvedProviderEntityImportAutomation = Schema.Struct({
	ruleId: Schema.String,
	sandboxScriptId: SandboxScriptId,
});
const entityPropertiesSchema = Schema.Record(Schema.String, jsonValueSchema);

const processSandboxEntityDetails = (payload: EntityImportPayload, executionId: string) =>
	Effect.gen(function* () {
		const sandbox = yield* SandboxExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const resolveScript = pluginRuntime.resolveDetailsScript(payload.providerId).pipe(
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
			authority: payload.userId ? { type: "user", userId: payload.userId } : { type: "system" },
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
				.listProviderEntityImportAutomations(payload.entitySchemaSlug)
				.pipe(Effect.mapError(toSandboxRunError)),
		});
		if (automations.length > 0 && !payload.userId) {
			return yield* new SandboxRunError({
				message: "Provider import automations require a user authority",
			});
		}
		if (payload.userId) {
			const properties = yield* Schema.decodeUnknownEffect(entityPropertiesSchema)(
				importedEntity.properties,
			).pipe(Effect.mapError((error) => new SandboxRunError({ message: String(error) })));
			for (const [index, automation] of automations.entries()) {
				const hookExecutionId = `${executionId}-provider-import-automation-${index}`;
				const context = {
					automation: {
						operation: "create",
						ruleId: automation.ruleId,
						occurrenceId: hookExecutionId,
						occurredAt: importedEntity.updatedAt,
						origin: { kind: "import" },
						source: {
							kind: "entity",
							after: {
								properties,
								id: importedEntity.id,
								name: importedEntity.name,
								entitySchemaSlug: importedEntity.entitySchemaSlug,
							},
						},
					},
				} satisfies AutomationInput;
				const result = yield* sandbox
					.executeScript({
						input: context,
						executionId: hookExecutionId,
						scriptId: automation.sandboxScriptId,
						authority: { type: "user", userId: payload.userId },
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
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(SandboxExecutionService, sandbox),
				),
		} satisfies EntityImportWorkflowOperationsValue;
	}),
);
