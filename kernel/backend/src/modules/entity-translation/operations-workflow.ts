import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import type { DurableSchema } from "#lib/infrastructure/workflow";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import {
	PluginRuntimeResolver,
	type UnsupportedProviderOperationError,
} from "#modules/plugins/runtime-resolver";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { TranslateEntityWorkflowPayload } from "./entity-translation-workflow";

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
		const sandbox = yield* SandboxExecutionService;
		const pluginRuntime = yield* PluginRuntimeResolver;

		const processSandboxTranslation = Effect.fn("processSandboxTranslation")(function* (
			payload: TranslateEntityWorkflowPayload,
			executionId: string,
		) {
			const scriptId = yield* makeActivity({
				error: SandboxRunError,
				success: SandboxScriptId satisfies DurableSchema,
				name: `resolve-provider-translate-script-${executionId}`,
				execute: pluginRuntime.resolveUserTranslateScript(payload.userId, payload.providerId).pipe(
					Effect.map(({ id }) => id),
					Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
				),
			});
			return yield* sandbox
				.executeScript({
					scriptId,
					executionId: `${executionId}-sandbox-translate`,
					subject: { type: "user", userId: payload.userId },
					input: {
						language: payload.language,
						externalId: payload.externalId,
						properties: payload.properties,
						entitySchemaSlug: payload.entitySchemaSlug,
					},
				})
				.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
		});

		return {
			processSandbox: processSandboxTranslation,
		} satisfies TranslateEntityWorkflowOperationsValue;
	}),
);
