import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, toSandboxRunError } from "@ryot/contract/errors";
import type { SandboxCompletedResult as SandboxCompletedResultValue } from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { processSandboxExecution } from "#modules/sandbox/durable-queues";
import { SandboxRepository } from "#modules/sandbox/repository";

import type { EntityImportPayload } from "./schemas";

const processSandboxEntityDetails = (payload: EntityImportPayload, executionId: string) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const resolveScript = runWithDb(pluginRuntime.resolveDetailsScript(payload.providerId)).pipe(
			Effect.map(({ id }) => id),
			Effect.mapError(toSandboxRunError),
		);
		const scriptId = yield* Activity.make({
			error: SandboxRunError,
			success: SandboxScriptId,
			name: `resolve-provider-details-script-${executionId}`,
			execute: resolveScript,
		});
		return yield* processSandboxExecution({
			scriptId,
			context: { externalId: payload.externalId },
			executionId: `${executionId}-sandbox-details`,
			authority: payload.userId ? { type: "user", userId: payload.userId } : { type: "system" },
		});
	}).pipe(Effect.mapError(toSandboxRunError));

export type EntityImportWorkflowOperationsValue = {
	processSandbox: (
		payload: EntityImportPayload,
		executionId: string,
	) => Effect.Effect<
		SandboxCompletedResultValue,
		SandboxRunError,
		WorkflowEngine | WorkflowInstance
	>;
};

export class EntityImportWorkflowOperations extends Context.Tag("EntityImportWorkflowOperations")<
	EntityImportWorkflowOperations,
	EntityImportWorkflowOperationsValue
>() {}

export const EntityImportWorkflowOperationsLive = Layer.effect(
	EntityImportWorkflowOperations,
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;
		return {
			processSandbox: (payload, executionId) =>
				processSandboxEntityDetails(payload, executionId).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
		} satisfies EntityImportWorkflowOperationsValue;
	}),
);
