import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { Activity, DurableQueue, Workflow } from "@effect/workflow";
import type { Result as WorkflowResult } from "@effect/workflow/Workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Cause, Context, DateTime, Effect, Exit, Layer, Match, Option, Schema } from "effect";

import { DbRunner } from "#lib/db/service";
import { SandboxRunError, dieOnDbError, toSandboxRunError } from "#lib/errors";
import { encodeEntityUpdatedMessage, redisKeys, RedisService } from "#lib/redis";
import { EntitySchemaId, SandboxScriptId, UserId } from "#lib/schema/brands";
import { EntitiesRepository } from "#modules/entities/repository";
import { ListedEntity } from "#modules/entities/schemas";
import { EntitiesService } from "#modules/entities/service";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";
import type { SandboxCompletedResult as SandboxCompletedResultValue } from "#modules/sandbox/schemas";

import {
	EntityDetailsChildEntity,
	EntityDetailsRelatedEntity,
	decodeEntityDetailsResult,
	processChildEntityTree,
	processRelatedEntity,
} from "./population";
import type { ImportEntityRunResult } from "./schemas";

export const EntityImportPayload = Schema.Struct({
	scriptId: SandboxScriptId,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaId: EntitySchemaId,
	userId: Schema.NullOr(UserId),
});

export type EntityImportPayload = typeof EntityImportPayload.Type;

export type EntityImportRunResult = typeof ImportEntityRunResult.Type;

const workflowFailureResult = (
	cause: Cause.Cause<SandboxRunError>,
): Extract<EntityImportRunResult, { status: "failed" }> =>
	Option.match(Cause.failureOption(cause), {
		onNone: () => ({ status: "failed", error: "Import failed" }),
		onSome: (error) => ({ status: "failed", error: error.message }),
	});

export const toEntityImportRunResult = (
	result: WorkflowResult<ListedEntity, SandboxRunError> | undefined,
): EntityImportRunResult => {
	if (!result) {
		return { status: "pending" };
	}

	return Match.value(result).pipe(
		Match.tag("Suspended", () => ({ status: "pending" as const })),
		Match.orElse(({ exit }) =>
			Exit.match(exit, {
				onFailure: workflowFailureResult,
				onSuccess: (data) => ({ status: "completed" as const, data }),
			}),
		),
	);
};

const ValidatedEntityDetails = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	childEntities: Schema.Array(EntityDetailsChildEntity),
	relatedEntities: Schema.Array(EntityDetailsRelatedEntity),
});

const processSandboxEntityDetails = (payload: EntityImportPayload, executionId: string) =>
	DurableQueue.process(SandboxExecutionQueue, {
		driverName: "details",
		userId: payload.userId,
		scriptId: payload.scriptId,
		context: { externalId: payload.externalId },
		executionId: `${executionId}-sandbox-details`,
	}).pipe(Effect.mapError(toSandboxRunError));

export type EntityImportWorkflowOperationsValue = {
	processSandbox: (
		payload: EntityImportPayload,
		executionId: string,
	) => Effect.Effect<
		SandboxCompletedResultValue,
		SandboxRunError,
		WorkflowEngine | WorkflowInstance
	>;
};

export class EntityImportWorkflowOperations extends Context.Tag("EntityImportWorkflowOperations")<
	EntityImportWorkflowOperations,
	EntityImportWorkflowOperationsValue
>() {}

export const EntityImportWorkflowOperationsLive = Layer.effect(
	EntityImportWorkflowOperations,
	Effect.map(
		PersistedQueue.PersistedQueueFactory,
		(queueFactory) =>
			({
				processSandbox: (payload, executionId) =>
					processSandboxEntityDetails(payload, executionId).pipe(
						Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					),
			}) satisfies EntityImportWorkflowOperationsValue,
	),
);

export const runEntityImportWorkflow = Effect.fn("runEntityImportWorkflow")(function* (
	payload: EntityImportPayload,
	executionId: string,
	options: { activityPrefix?: string } = {},
) {
	const redis = yield* RedisService;
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const operations = yield* EntityImportWorkflowOperations;
	const activityName = (name: string) =>
		options.activityPrefix ? `${options.activityPrefix}${name}` : name;

	const existing = yield* Activity.make({
		success: Schema.NullOr(ListedEntity),
		name: activityName("check-existing-entity"),
		execute: runWithDb(
			repository.findGlobalEntityByExternalId({
				externalId: payload.externalId,
				sandboxScriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
			}),
		).pipe(dieOnDbError),
	});

	if (existing && existing.populatedAt !== null) {
		return existing;
	}

	const sandboxResult = yield* operations.processSandbox(payload, executionId);

	if (sandboxResult.error) {
		return yield* new SandboxRunError({ message: sandboxResult.error });
	}

	const validatedDetails = yield* Activity.make({
		error: SandboxRunError,
		success: ValidatedEntityDetails,
		name: activityName("validate-entity-details"),
		execute: Effect.gen(function* () {
			const details = yield* decodeEntityDetailsResult(sandboxResult.value).pipe(
				Effect.mapError(
					(error) => new SandboxRunError({ message: `Invalid entity details: ${error.message}` }),
				),
			);

			return {
				name: details.name,
				properties: details.properties,
				childEntities: details.childEntities ?? [],
				relatedEntities: details.relatedEntities ?? [],
			};
		}),
	});

	const entity = yield* Activity.make({
		success: ListedEntity,
		error: SandboxRunError,
		name: activityName("write-primary-entity"),
		execute: entities
			.save({
				scope: "global",
				populatedAt: null,
				name: validatedDetails.name,
				externalId: payload.externalId,
				sandboxScriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
				properties: validatedDetails.properties,
			})
			.pipe(
				dieOnDbError,
				Effect.mapError((error) => new SandboxRunError({ message: error.message })),
			),
	});

	yield* Effect.forEach(
		validatedDetails.relatedEntities,
		(relatedEntity) =>
			Activity.make({
				error: SandboxRunError,
				name: activityName(`write-related-${relatedEntity.scriptSlug}-${relatedEntity.externalId}`),
				execute: processRelatedEntity({
					relatedEntity,
					sourceEntityId: entity.id,
					sourceEntitySchemaId: payload.entitySchemaId,
				}),
			}),
		{ discard: true },
	);

	yield* processChildEntityTree({
		parentEntityId: entity.id,
		sandboxScriptId: payload.scriptId,
		activityPrefix: activityName(""),
		parentEntitySchemaId: payload.entitySchemaId,
		childEntities: validatedDetails.childEntities,
	});

	const populatedEntity = yield* Activity.make({
		error: SandboxRunError,
		success: ListedEntity,
		name: activityName("mark-primary-entity-populated"),
		execute: Effect.gen(function* () {
			const populatedAt = yield* DateTime.nowAsDate;
			const saved = yield* entities
				.save({
					populatedAt,
					scope: "global",
					name: validatedDetails.name,
					externalId: payload.externalId,
					sandboxScriptId: payload.scriptId,
					entitySchemaId: payload.entitySchemaId,
					properties: validatedDetails.properties,
				})
				.pipe(
					dieOnDbError,
					Effect.mapError((error) => new SandboxRunError({ message: error.message })),
				);
			yield* redis.publish(
				redisKeys.entityUpdatedChannel,
				encodeEntityUpdatedMessage(saved.id, "populated"),
			);
			return saved;
		}),
	});

	return populatedEntity;
});

export const BuiltinEntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	payload: EntityImportPayload,
	name: "BuiltinEntityImportWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

const BuiltinEntityImportWorkflowLive = BuiltinEntityImportWorkflow.toLayer(
	(payload, executionId) => runEntityImportWorkflow(payload, executionId),
);

export const BuiltinEntityImportWorkflowDefinitionsLive = BuiltinEntityImportWorkflowLive;
