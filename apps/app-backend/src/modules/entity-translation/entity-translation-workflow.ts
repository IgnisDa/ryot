import { Activity, Workflow } from "@effect/workflow";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import { EntityId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/db/service";
import { redisKeys, RedisService } from "#lib/redis";

import { TranslateEntityWorkflowOperations } from "./operations-workflow";
import { TranslationsRepository } from "./repository";

export const TranslateEntityWorkflowPayload = Schema.Struct({
	entityId: EntityId,
	language: Schema.String,
	externalId: Schema.String,
	scriptId: SandboxScriptId,
	properties: Schema.Unknown,
	executionId: Schema.String,
	entitySchemaSlug: Schema.String,
});

export type TranslateEntityWorkflowPayload = typeof TranslateEntityWorkflowPayload.Type;

export const translateEntityExecutionId = (input: { entityId: EntityId; language: string }) =>
	`translate-${input.entityId}-${input.language}`;

const TranslateDriverResult = Schema.Struct({
	name: Schema.optional(Schema.NullOr(Schema.String)),
	properties: Schema.optional(
		Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
	),
});

type TranslateDriverResult = typeof TranslateDriverResult.Type;

const decodeTranslation = (value: unknown) =>
	Schema.decodeUnknown(TranslateDriverResult)(value).pipe(
		Effect.mapError(
			(error) => new SandboxRunError({ message: `Invalid translate result: ${error.message}` }),
		),
	);

const writeTranslationOverlay = Effect.fn("writeTranslationOverlay")(function* (
	payload: TranslateEntityWorkflowPayload,
	translation: TranslateDriverResult,
) {
	const redis = yield* RedisService;
	const runWithDb = yield* DbRunner;
	const repository = yield* TranslationsRepository;

	return yield* Activity.make({
		success: Schema.Void,
		error: SandboxRunError,
		name: "write-translation-overlay",
		execute: Effect.gen(function* () {
			const populatedAt = yield* DateTime.nowAsDate;
			yield* runWithDb(
				repository.upsertOverlay({
					populatedAt,
					entityId: payload.entityId,
					language: payload.language,
					name: translation.name ?? null,
					properties: translation.properties ?? null,
				}),
			).pipe(dieOnDbError);
			yield* redis.publish(
				redisKeys.entityUpdatedChannel,
				encodeEntityUpdatedMessage(payload.entityId, "translated"),
			);
		}),
	});
});

export const TranslateEntityWorkflow = Workflow.make({
	success: Schema.Void,
	error: SandboxRunError,
	name: "TranslateEntityWorkflow",
	payload: TranslateEntityWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const runTranslateEntityWorkflow = Effect.fn("runTranslateEntityWorkflow")(function* (
	payload: TranslateEntityWorkflowPayload,
	executionId: string,
) {
	const operations = yield* TranslateEntityWorkflowOperations;
	const sandboxResult = yield* operations.processSandbox(payload, executionId);

	if (sandboxResult.error) {
		return yield* new SandboxRunError({ message: sandboxResult.error });
	}

	const translation = yield* decodeTranslation(sandboxResult.value);
	return yield* writeTranslationOverlay(payload, translation);
});

const TranslateEntityWorkflowLive = TranslateEntityWorkflow.toLayer((payload, executionId) =>
	runTranslateEntityWorkflow(payload, executionId),
);

export const TranslateEntityWorkflowDefinitionsLive = TranslateEntityWorkflowLive;
