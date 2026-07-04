import { Activity } from "@effect/workflow";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import type { ProviderTranslateResult } from "@ryot/sandbox-sdk/provider";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { decodeProviderTranslateResult } from "#modules/sandbox/provider-contracts";

import {
	TranslateEntityWorkflow,
	type TranslateEntityWorkflowPayload,
} from "./entity-translation-workflow";
import { TranslateEntityWorkflowOperations } from "./operations-workflow";
import { TranslationsRepository } from "./repository";
import { TranslationsService } from "./service";

const writeTranslationOverlay = Effect.fn("writeTranslationOverlay")(function* (
	payload: TranslateEntityWorkflowPayload,
	translation: ProviderTranslateResult,
) {
	const redis = yield* RedisService;
	const runWithDb = yield* DbRunner;
	const translations = yield* TranslationsService;
	const repository = yield* TranslationsRepository;

	return yield* Activity.make({
		success: Schema.Void,
		error: SandboxRunError,
		name: "write-translation-overlay",
		execute: Effect.gen(function* () {
			const populatedAt = yield* DateTime.nowAsDate;
			const input = {
				populatedAt,
				entityId: payload.entityId,
				language: payload.language,
				name: translation.name ?? null,
				properties: translation.properties ?? null,
			};
			const existing = yield* runWithDb(
				repository.findOverlay({ entityId: input.entityId, language: input.language }),
			).pipe(dieOnDbError);

			const write = existing
				? translations.update(input)
				: translations
						.create(input)
						.pipe(Effect.catchTag("Conflict", () => translations.update(input)));

			yield* write.pipe(
				dieOnDbError,
				Effect.catchTag("NotFound", (error) =>
					Effect.fail(new SandboxRunError({ message: error.message })),
				),
			);
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
			scriptId: payload.scriptId,
			externalId: payload.externalId,
		});
		const operations = yield* TranslateEntityWorkflowOperations;
		const sandboxResult = yield* operations.processSandbox(payload, executionId);

		if (sandboxResult.error) {
			return yield* new SandboxRunError({ message: sandboxResult.error.message });
		}

		const translation = yield* decodeProviderTranslateResult(sandboxResult.value).pipe(
			Effect.mapError(
				(error) => new SandboxRunError({ message: `Invalid translate result: ${error.message}` }),
			),
		);
		return yield* writeTranslationOverlay(payload, translation);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "TranslateEntityWorkflow" }),
);

const TranslateEntityWorkflowLive = TranslateEntityWorkflow.toLayer(runTranslateEntityWorkflow);

export const TranslateEntityWorkflowDefinitionsLive = TranslateEntityWorkflowLive;
