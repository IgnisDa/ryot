import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { Context, Effect, Layer } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import type { DurableSchema } from "#boot/workflow-engine";
import type { SandboxExecutionResult } from "#modules/scripts/executions/result";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { makeActivity } from "#platform/workflow/scope";

import {
	type TranslateEntityWorkflowPayload,
	TranslationExecution,
} from "./entity-translation-workflow";
import { TranslationsService } from "./service";

export type TranslateEntityWorkflowOperationsValue = {
	releaseRegistration: (executionId: string) => Effect.Effect<void, SandboxRunError>;
	captureExecution: (
		payload: TranslateEntityWorkflowPayload,
		executionId: string,
		attempt: number,
	) => Effect.Effect<TranslationExecution, SandboxRunError, WorkflowEngine | WorkflowInstance>;
	processSandbox: (
		payload: TranslateEntityWorkflowPayload,
		executionId: string,
		capturedExecution: TranslationExecution,
	) => Effect.Effect<
		{ result: SandboxExecutionResult; execution: TranslationExecution },
		SandboxRunError,
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
		const sandbox = yield* ScriptExecutionService;
		const translations = yield* TranslationsService;

		const captureExecution = Effect.fn("captureTranslationExecution")(function* (
			payload: TranslateEntityWorkflowPayload,
			executionId: string,
			attempt: number,
		) {
			return yield* makeActivity({
				error: SandboxRunError,
				success: TranslationExecution satisfies DurableSchema,
				name: `capture-provider-translation-${executionId}:${attempt}`,
				execute: translations
					.admitExecution(payload)
					.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
			});
		});
		const processSandboxTranslation = Effect.fn("processSandboxTranslation")(function* (
			payload: TranslateEntityWorkflowPayload,
			executionId: string,
			execution: TranslationExecution,
		) {
			const pluginRevision = execution.principal.pluginRevision;
			if (!pluginRevision) {
				return yield* new SandboxRunError({
					kind: "missing-artifact",
					message: "Translation plugin pin is unavailable",
				});
			}
			const result = yield* sandbox
				.executeScript({
					pluginRevision,
					lane: payload.lane,
					subject: execution.principal.subject,
					scriptId: execution.principal.scriptId,
					executionId: `${executionId}-sandbox-translate`,
					input: {
						name: execution.name,
						language: payload.language,
						externalId: payload.externalId,
						properties: execution.properties,
						entitySchemaSlug: payload.entitySchemaSlug,
					},
				})
				.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
			return { result, execution };
		});

		return {
			captureExecution,
			processSandbox: processSandboxTranslation,
			releaseRegistration: (executionId) =>
				sandbox
					.releaseWorkflowRegistration(executionId)
					.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
		} satisfies TranslateEntityWorkflowOperationsValue;
	}),
);
