import { SandboxRunError, toSandboxRunError } from "@ryot/contract/errors";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import { Activity } from "effect/unstable/workflow";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { EntityImportPayload } from "./schemas";

const processSandboxEntityDetails = (payload: EntityImportPayload, executionId: string) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const sandbox = yield* SandboxExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const resolveScript = runWithDb(pluginRuntime.resolveDetailsScript(payload.providerId)).pipe(
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

export type EntityImportWorkflowOperationsValue = {
	processSandbox: (
		payload: EntityImportPayload,
		executionId: string,
	) => Effect.Effect<SandboxExecutionResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
};

export class EntityImportWorkflowOperations extends Context.Service<
	EntityImportWorkflowOperations,
	EntityImportWorkflowOperationsValue
>()("EntityImportWorkflowOperations") {}

export const EntityImportWorkflowOperationsLive = Layer.effect(
	EntityImportWorkflowOperations,
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const sandbox = yield* SandboxExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		return {
			processSandbox: (payload, executionId) =>
				processSandboxEntityDetails(payload, executionId).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(SandboxExecutionService, sandbox),
				),
		} satisfies EntityImportWorkflowOperationsValue;
	}),
);
