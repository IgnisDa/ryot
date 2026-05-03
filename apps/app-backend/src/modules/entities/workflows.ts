import { Activity, DurableQueue, Workflow } from "@effect/workflow";
import { Cause, DateTime, Effect, Exit, Match, Option, Schema } from "effect";

import { DbRunner } from "#lib/db";
import { SandboxRunError, dieOnDbError, unknownToMessage } from "#lib/errors";
import { parseAppSchemaProperties } from "#lib/property-schema-runtime";
import { CollectionsService } from "#modules/collections/service";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";
import type { SandboxCompletedResult as SandboxCompletedResultValue } from "#modules/sandbox/schemas";

import {
	EntityDetailsRelatedEntity,
	decodeEntityDetailsResult,
	processRelatedEntity,
} from "./population";
import { EntitiesRepository } from "./repository";
import { ListedEntity } from "./schemas";

export const EntityImportPayload = Schema.Struct({
	userId: Schema.String,
	scriptId: Schema.String,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaId: Schema.String,
});

export type EntityImportPayload = typeof EntityImportPayload.Type;

export type EntityImportRunResult =
	| { readonly status: "pending" }
	| { readonly status: "failed"; readonly error: string }
	| { readonly status: "completed"; readonly data: ListedEntity };

export const EntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	name: "EntityImportWorkflow",
	payload: EntityImportPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

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

const extractPrimaryRemoteImage = (images: unknown) => {
	if (!Array.isArray(images)) {
		return null;
	}

	for (const image of images) {
		if (typeof image !== "object" || image === null) {
			continue;
		}

		const url = Reflect.get(image, "url");
		const type = Reflect.get(image, "type");
		if (type === "remote" && typeof url === "string" && url.length > 0) {
			return url;
		}
	}

	return null;
};

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
	image: Schema.NullOr(Schema.String),
	relatedEntities: Schema.Array(EntityDetailsRelatedEntity),
	validatedProperties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

const processSandboxEntityDetails = (payload: EntityImportPayload, executionId: string) =>
	DurableQueue.process(SandboxExecutionQueue, {
		driverName: "details",
		userId: payload.userId,
		scriptId: payload.scriptId,
		context: { externalId: payload.externalId },
		executionId: `${executionId}-sandbox-details`,
	}).pipe(Effect.mapError(toWorkflowError));

export const runEntityImportWorkflow = <R>(
	payload: EntityImportPayload,
	executionId: string,
	processSandbox: (
		payload: EntityImportPayload,
		executionId: string,
	) => Effect.Effect<SandboxCompletedResultValue, SandboxRunError, R>,
	options: { activityPrefix?: string; skipLibraryMembership?: boolean } = {},
) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* EntitiesRepository;
		const collections = yield* CollectionsService;
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
			if (!options.skipLibraryMembership) {
				yield* Activity.make({
					name: activityName("ensure-library-membership"),
					execute: collections
						.ensureEntityInLibrary(payload.userId, existing.id)
						.pipe(dieOnDbError),
				});
			}
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
					relatedEntities: details.relatedEntities ?? [],
					image: extractPrimaryRemoteImage(validatedProperties.images),
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
					name: activityName(
						`write-related-${relatedEntity.scriptSlug}-${relatedEntity.externalId}`,
					),
					execute: processRelatedEntity({
						relatedEntity,
						sourceEntityId: entity.id,
						sourceEntitySchemaId: payload.entitySchemaId,
					}),
				}),
			{ discard: true },
		);

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

		if (!options.skipLibraryMembership) {
			yield* Activity.make({
				name: activityName("ensure-library-membership"),
				execute: collections
					.ensureEntityInLibrary(payload.userId, populatedEntity.id)
					.pipe(dieOnDbError),
			});
		}

		return populatedEntity;
	});

const EntityImportWorkflowLive = EntityImportWorkflow.toLayer((payload, executionId) =>
	runEntityImportWorkflow(payload, executionId, processSandboxEntityDetails),
);

export const EntityImportWorkflowDefinitionsLive = EntityImportWorkflowLive;
