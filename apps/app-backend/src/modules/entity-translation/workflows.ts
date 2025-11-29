import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { Activity, DurableQueue, Workflow } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, dieOnDbError, toSandboxRunError } from "@ryot/contract/errors";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import type { SandboxCompletedResult as SandboxCompletedResultValue } from "@ryot/contract/modules/sandbox/schemas";
import { EntityId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { DbRunner } from "#lib/db/service";
import { redisKeys, RedisService } from "#lib/redis";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";

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

export const TranslateEntityWorkflow = Workflow.make({
	success: Schema.Void,
	error: SandboxRunError,
	name: "TranslateEntityWorkflow",
	payload: TranslateEntityWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const processSandboxTranslation = (payload: TranslateEntityWorkflowPayload, executionId: string) =>
	DurableQueue.process(SandboxExecutionQueue, {
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

export type TranslateEntityWorkflowOperationsValue = {
	processSandbox: (
		payload: TranslateEntityWorkflowPayload,
		executionId: string,
	) => Effect.Effect<
		SandboxCompletedResultValue,
		SandboxRunError,
		WorkflowEngine | WorkflowInstance
	>;
};

export class TranslateEntityWorkflowOperations extends Context.Tag(
	"TranslateEntityWorkflowOperations",
)<TranslateEntityWorkflowOperations, TranslateEntityWorkflowOperationsValue>() {}

export const TranslateEntityWorkflowOperationsLive = Layer.effect(
	TranslateEntityWorkflowOperations,
	Effect.map(
		PersistedQueue.PersistedQueueFactory,
		(queueFactory) =>
			({
				processSandbox: (payload, executionId) =>
					processSandboxTranslation(payload, executionId).pipe(
						Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					),
			}) satisfies TranslateEntityWorkflowOperationsValue,
	),
);

export const runTranslateEntityWorkflow = Effect.fn("runTranslateEntityWorkflow")(function* (
	payload: TranslateEntityWorkflowPayload,
	executionId: string,
) {
	const redis = yield* RedisService;
	const runWithDb = yield* DbRunner;
	const repository = yield* TranslationsRepository;
	const operations = yield* TranslateEntityWorkflowOperations;

	const sandboxResult = yield* operations.processSandbox(payload, executionId);

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
