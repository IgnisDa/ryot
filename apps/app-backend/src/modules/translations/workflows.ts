import { Activity, DurableQueue, Workflow } from "@effect/workflow";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/db/service";
import { SandboxRunError, dieOnDbError, toSandboxRunError } from "#lib/errors";
import { encodeEntityUpdatedMessage, redisKeys, RedisService } from "#lib/redis";
import { EntityId, SandboxScriptId } from "#lib/schema/brands";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";

import { TranslationsRepository } from "./repository";

const TranslateEntityWorkflowPayload = Schema.Struct({
	entityId: EntityId,
	language: Schema.String,
	externalId: Schema.String,
	scriptId: SandboxScriptId,
	properties: Schema.Unknown,
	executionId: Schema.String,
	entitySchemaSlug: Schema.String,
});

type TranslateEntityWorkflowPayload = typeof TranslateEntityWorkflowPayload.Type;

export const translateEntityExecutionId = (input: { entityId: EntityId; language: string }) =>
	`translate-${input.entityId}-${input.language}`;

const TranslateDriverResult = Schema.Struct({
	name: Schema.optional(Schema.NullOr(Schema.String)),
	properties: Schema.optional(
		Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
	),
});

export const TranslateEntityWorkflow = Workflow.make({
	success: Schema.Void,
	error: SandboxRunError,
	name: "TranslateEntityWorkflow",
	payload: TranslateEntityWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const runTranslateEntityWorkflow = Effect.fn("runTranslateEntityWorkflow")(function* (
	payload: TranslateEntityWorkflowPayload,
	executionId: string,
) {
	const redis = yield* RedisService;
	const runWithDb = yield* DbRunner;
	const repository = yield* TranslationsRepository;

	const sandboxResult = yield* DurableQueue.process(SandboxExecutionQueue, {
		userId: null,
		driverName: "translate",
		scriptId: payload.scriptId,
		executionId: `${executionId}-sandbox-translate`,
		context: {
			language: payload.language,
			externalId: payload.externalId,
			properties: payload.properties,
			entitySchemaSlug: payload.entitySchemaSlug,
		},
	}).pipe(Effect.mapError(toSandboxRunError));

	// A transient provider failure leaves no row, so the next detail read cleanly
	// re-requests the fill. A successful run always upserts a row (with all-null
	// fields when the provider has no translation) so the state never stays pending.
	if (sandboxResult.error) {
		return yield* new SandboxRunError({ message: sandboxResult.error });
	}

	const translation = yield* Schema.decodeUnknown(TranslateDriverResult)(sandboxResult.value).pipe(
		Effect.mapError(
			(error) => new SandboxRunError({ message: `Invalid translate result: ${error.message}` }),
		),
	);

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
			// Nudges streams interested in this entity to refetch. `translated` marks that the
			// translation step settled — including a negative-cache write (no provider translation;
			// status becomes `none`); it signals "translation resolved, refetch", not that a
			// translation necessarily now exists.
			yield* redis.publish(
				redisKeys.entityUpdatedChannel,
				encodeEntityUpdatedMessage(payload.entityId, "translated"),
			);
		}),
	});
});

const TranslateEntityWorkflowLive = TranslateEntityWorkflow.toLayer((payload, executionId) =>
	runTranslateEntityWorkflow(payload, executionId),
);

export const TranslateEntityWorkflowDefinitionsLive = TranslateEntityWorkflowLive;
