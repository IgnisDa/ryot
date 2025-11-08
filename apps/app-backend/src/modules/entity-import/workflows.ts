import { Activity, DurableQueue, Workflow } from "@effect/workflow";
import { Cause, DateTime, Effect, Exit, Match, Option, Schema } from "effect";

import { DbRunner } from "#lib/db";
import { SandboxRunError, dieOnDbError, unknownToMessage } from "#lib/errors";
import { EntitySchemaId, SandboxScriptId, UserId } from "#lib/schema/brands";
import { parseAppSchemaProperties } from "#lib/schema/property-schema-runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntityImage, ListedEntity } from "#modules/entities/schemas";
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

const toWorkflowError = (cause: unknown) =>
	cause instanceof SandboxRunError
		? cause
		: new SandboxRunError({ message: unknownToMessage(cause) });

const workflowFailureResult = (
	cause: Cause.Cause<SandboxRunError>,
): Extract<EntityImportRunResult, { status: "failed" }> =>
	Option.match(Cause.failureOption(cause), {
		onNone: () => ({ status: "failed", error: "Import failed" }),
		onSome: (error) => ({ status: "failed", error: error.message }),
	});

export const toEntityImportRunResult = (
	result: Workflow.Result<ListedEntity, SandboxRunError> | undefined,
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
	image: Schema.NullOr(EntityImage),
	childEntities: Schema.Array(EntityDetailsChildEntity),
	relatedEntities: Schema.Array(EntityDetailsRelatedEntity),
	validatedProperties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export const processSandboxEntityDetails = (payload: EntityImportPayload, executionId: string) =>
	DurableQueue.process(SandboxExecutionQueue, {
		driverName: "details",
		userId: payload.userId,
		scriptId: payload.scriptId,
		context: { externalId: payload.externalId },
		executionId: `${executionId}-sandbox-details`,
	}).pipe(Effect.mapError(toWorkflowError));

export const runEntityImportWorkflow = Effect.fn("runEntityImportWorkflow")(function* <R>(
	payload: EntityImportPayload,
	executionId: string,
	processSandbox: (
		payload: EntityImportPayload,
		executionId: string,
	) => Effect.Effect<SandboxCompletedResultValue, SandboxRunError, R>,
	options: { activityPrefix?: string } = {},
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* EntitiesRepository;
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

	const sandboxResult = yield* processSandbox(payload, executionId);

	if (sandboxResult.error) {
		return yield* new SandboxRunError({ message: sandboxResult.error });
	}

	const validatedDetails = yield* Activity.make({
		error: SandboxRunError,
		success: ValidatedEntityDetails,
		name: activityName("validate-entity-details"),
		execute: Effect.gen(function* () {
			const entitySchemaScope = yield* runWithDb(
				repository.findEntitySchemaById(payload.entitySchemaId),
			).pipe(dieOnDbError);

			if (!entitySchemaScope) {
				return yield* new SandboxRunError({ message: "Entity schema not found" });
			}

			const details = yield* decodeEntityDetailsResult(sandboxResult.value).pipe(
				Effect.mapError(
					(error) => new SandboxRunError({ message: `Invalid entity details: ${error.message}` }),
				),
			);

			const validatedProperties = yield* parseAppSchemaProperties({
				kind: "Entity",
				properties: details.properties,
				propertiesSchema: entitySchemaScope.propertiesSchema,
			}).pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));

			return {
				name: details.name,
				validatedProperties,
				image: details.image ?? null,
				childEntities: details.childEntities ?? [],
				relatedEntities: details.relatedEntities ?? [],
			};
		}),
	});

	const entity = yield* Activity.make({
		success: ListedEntity,
		name: activityName("write-primary-entity"),
		execute: runWithDb(
			repository.createOrUpdateGlobalEntity({
				image: null,
				populatedAt: null,
				name: validatedDetails.name,
				externalId: payload.externalId,
				sandboxScriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
				properties: validatedDetails.validatedProperties,
			}),
		).pipe(dieOnDbError),
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
		success: ListedEntity,
		name: activityName("mark-primary-entity-populated"),
		execute: Effect.gen(function* () {
			const populatedAt = yield* DateTime.nowAsDate;
			return yield* runWithDb(
				repository.createOrUpdateGlobalEntity({
					populatedAt,
					name: validatedDetails.name,
					image: validatedDetails.image,
					externalId: payload.externalId,
					sandboxScriptId: payload.scriptId,
					entitySchemaId: payload.entitySchemaId,
					properties: validatedDetails.validatedProperties,
				}),
			).pipe(dieOnDbError);
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
	(payload, executionId) =>
		runEntityImportWorkflow(payload, executionId, processSandboxEntityDetails),
);

export const BuiltinEntityImportWorkflowDefinitionsLive = BuiltinEntityImportWorkflowLive;
