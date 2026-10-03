import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { Context, Effect, Layer } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import type { DurableSchema } from "#lib/infrastructure/workflow";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxExecutionService } from "#modules/sandbox/service";

import {
	TranslationExecution,
	type TranslateEntityWorkflowPayload,
} from "./entity-translation-workflow";
import { TranslationsService } from "./service";

export type TranslateEntityWorkflowOperationsValue = {
	processSandbox: (
		payload: TranslateEntityWorkflowPayload,
		executionId: string,
	) => Effect.Effect<
		{ execution: TranslationExecution; result: SandboxExecutionResult },
		SandboxRunError,
		WorkflowEngine | WorkflowInstance
	>;
	releaseRegistration: (executionId: string) => Effect.Effect<void, SandboxRunError>;
};

export class TranslateEntityWorkflowOperations extends Context.Service<
	TranslateEntityWorkflowOperations,
	TranslateEntityWorkflowOperationsValue
>()("TranslateEntityWorkflowOperations") {}

export const TranslateEntityWorkflowOperationsLive = Layer.effect(
	TranslateEntityWorkflowOperations,
	Effect.gen(function* () {
		const sandbox = yield* SandboxExecutionService;
		const translations = yield* TranslationsService;

		const processSandboxTranslation = Effect.fn("processSandboxTranslation")(function* (
			payload: TranslateEntityWorkflowPayload,
			executionId: string,
		) {
			const execution = yield* makeActivity({
				error: SandboxRunError,
				name: `capture-provider-translation-${executionId}`,
				success: TranslationExecution satisfies DurableSchema,
				execute: translations
					.admitExecution(payload, executionId)
					.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
			});
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
			processSandbox: processSandboxTranslation,
			releaseRegistration: (executionId) =>
				sandbox
					.releaseWorkflowRegistration(executionId)
					.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
		} satisfies TranslateEntityWorkflowOperationsValue;
	}),
);
