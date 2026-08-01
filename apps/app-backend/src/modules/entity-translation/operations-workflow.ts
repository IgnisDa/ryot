import type { SandboxRunError } from "@ryot/contract/errors";
import { toSandboxRunError } from "@ryot/contract/errors";
import { Context, Effect, Layer } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DbRunner } from "#lib/infrastructure/db/service";
import {
	PluginRuntimeResolver,
	type UnsupportedProviderOperationError,
} from "#modules/plugins/runtime-resolver";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { TranslateEntityWorkflowPayload } from "./entity-translation-workflow";

const processSandboxTranslation = Effect.fn("processSandboxTranslation")(function* (
	payload: TranslateEntityWorkflowPayload,
	executionId: string,
) {
	const runWithDb = yield* DbRunner;
	const sandbox = yield* SandboxExecutionService;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const script = yield* runWithDb(pluginRuntime.resolveTranslateScript(payload.providerId)).pipe(
		Effect.catchTag("DbError", (error) => Effect.fail(toSandboxRunError(error))),
	);
	return yield* sandbox
		.executeScript({
			scriptId: script.id,
			authority: { type: "system" },
			executionId: `${executionId}-sandbox-translate`,
			input: {
				language: payload.language,
				externalId: payload.externalId,
				properties: payload.properties,
				entitySchemaSlug: payload.entitySchemaSlug,
			},
		})
		.pipe(Effect.mapError(toSandboxRunError));
});

export type TranslateEntityWorkflowOperationsValue = {
	processSandbox: (
		payload: TranslateEntityWorkflowPayload,
		executionId: string,
	) => Effect.Effect<
		SandboxExecutionResult,
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
		const sandbox = yield* SandboxExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		return {
			processSandbox: (payload, executionId) =>
				processSandboxTranslation(payload, executionId).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(PluginRuntimeResolver, pluginRuntime),
					Effect.provideService(SandboxExecutionService, sandbox),
				),
		} satisfies TranslateEntityWorkflowOperationsValue;
	}),
);
