import type { SandboxRunError } from "@ryot/contract/errors";
import { toSandboxRunError } from "@ryot/contract/errors";
import type { SandboxCompletedResult as SandboxCompletedResultValue } from "@ryot/contract/modules/sandbox/schemas";
import { Context, Effect, Layer } from "effect";
import { PersistedQueue } from "effect/unstable/persistence";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DbRunner } from "#lib/infrastructure/db/service";
import {
	PluginRuntimeResolver,
	type UnsupportedProviderOperationError,
} from "#modules/plugins/runtime-resolver";
import { processSandboxExecution } from "#modules/sandbox/durable-queues";
import { SandboxPluginScriptResolver } from "#modules/sandbox/plugin-script-resolver";
import { SandboxRepository } from "#modules/sandbox/repository";

import type { TranslateEntityWorkflowPayload } from "./entity-translation-workflow";

const processSandboxTranslation = Effect.fn("processSandboxTranslation")(function* (
	payload: TranslateEntityWorkflowPayload,
	executionId: string,
) {
	const runWithDb = yield* DbRunner;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const script = yield* runWithDb(pluginRuntime.resolveTranslateScript(payload.providerId)).pipe(
		Effect.catchTag("DbError", (error) => Effect.fail(toSandboxRunError(error))),
	);
	return yield* processSandboxExecution({
		scriptId: script.id,
		authority: { type: "system" },
		executionId: `${executionId}-sandbox-translate`,
		context: {
			language: payload.language,
			externalId: payload.externalId,
			properties: payload.properties,
			entitySchemaSlug: payload.entitySchemaSlug,
		},
	}).pipe(Effect.mapError(toSandboxRunError));
});

export type TranslateEntityWorkflowOperationsValue = {
	processSandbox: (
		payload: TranslateEntityWorkflowPayload,
		executionId: string,
	) => Effect.Effect<
		SandboxCompletedResultValue,
		SandboxRunError | UnsupportedProviderOperationError,
		WorkflowEngine | WorkflowInstance
	>;
};

export class TranslateEntityWorkflowOperations extends Context.Service<
	TranslateEntityWorkflowOperations,
	TranslateEntityWorkflowOperationsValue
>()("TranslateEntityWorkflowOperations") {}

export const TranslateEntityWorkflowOperationsLive = Layer.effect(
	TranslateEntityWorkflowOperations,
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const pluginScriptResolver = yield* SandboxPluginScriptResolver;
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;
		return {
			processSandbox: (payload, executionId) =>
				processSandboxTranslation(payload, executionId).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(SandboxPluginScriptResolver, pluginScriptResolver),
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
		} satisfies TranslateEntityWorkflowOperationsValue;
	}),
);
