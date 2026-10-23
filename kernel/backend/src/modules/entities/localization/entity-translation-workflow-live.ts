import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import {
	type ProviderTranslateResult,
	providerTranslateResultSchema,
} from "@ryot-app/plugin-backend-sdk/provider";
import { DateTime, Effect, Schema } from "effect";

import type { DurableSchema } from "#boot/workflow-engine";
import { redisKeys, RedisService } from "#platform/redis";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import {
	TranslateEntityWorkflow,
	type TranslateEntityWorkflowPayload,
	type TranslationExecution,
} from "./entity-translation-workflow";
import { TranslateEntityWorkflowOperations } from "./operations-workflow";
import { TranslationsService } from "./service";

const decodeProviderTranslateResult = Schema.decodeUnknownEffect(providerTranslateResultSchema);

const writeTranslationOverlay = Effect.fn("writeTranslationOverlay")(function* (
	payload: TranslateEntityWorkflowPayload,
	execution: TranslationExecution,
	translation: ProviderTranslateResult,
) {
	const redis = yield* RedisService;
	const translations = yield* TranslationsService;

	return yield* makeActivity({
		name: "write-translation-overlay",
		success: Schema.Void satisfies DurableSchema,
		error: SandboxRunError satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const populatedAt = yield* DateTime.nowAsDate;
			yield* translations
				.upsert(
					{
						populatedAt,
						entityId: payload.entityId,
						language: payload.language,
						name: translation.name ?? null,
						properties: translation.properties ?? null,
					},
					payload,
					execution,
				)
				.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
			yield* redis.publish(
				redisKeys.entityUpdatedChannel,
				encodeEntityUpdatedMessage(payload.entityId, "translated"),
			);
		}),
	});
});

export const runTranslateEntityWorkflow = Effect.fn("TranslateEntityWorkflow")(
	function* (payload: TranslateEntityWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			entityId: payload.entityId,
			externalId: payload.externalId,
			providerId: payload.providerId,
		});
		const operations = yield* TranslateEntityWorkflowOperations;
		const { execution, result: sandboxResult } = yield* operations
			.processSandbox(payload, executionId)
			.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));

		if (sandboxResult.error) {
			return yield* new SandboxRunError({
				kind: sandboxResult.error.kind,
				message: sandboxResult.error.message,
			});
		}

		const translation = yield* decodeProviderTranslateResult(sandboxResult.value).pipe(
			Effect.mapError(
				(error) =>
					new SandboxRunError({
						kind: "invalid-output",
						message: `Invalid translate result: ${error.message}`,
					}),
			),
		);
		yield* writeTranslationOverlay(payload, execution, translation);
		return yield* makeActivity({
			error: SandboxRunError,
			name: "release-translation-registration",
			success: Schema.Void satisfies DurableSchema,
			execute: operations.releaseRegistration(executionId),
		});
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "TranslateEntityWorkflow" }),
);

export const TranslateEntityWorkflowDefinitionsLive = implementWorkflow(
	TranslateEntityWorkflow,
	runTranslateEntityWorkflow,
);
