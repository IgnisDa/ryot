import { Activity, Workflow } from "@effect/workflow";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import { EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	EntityDetailsChildEntity,
	EntityDetailsRelatedEntity,
	decodeEntityDetailsResult,
	processChildEntityTree,
	processRelatedEntity,
	syncRelatedEntitiesByRelationshipSchema,
} from "./population";

export const EntityImportPayload = Schema.Struct({
	scriptId: SandboxScriptId,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaId: EntitySchemaId,
	userId: Schema.NullOr(UserId),
});

export type EntityImportPayload = typeof EntityImportPayload.Type;

type ActivityName = (name: string) => string;

const ValidatedEntityDetails = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	childEntities: Schema.Array(EntityDetailsChildEntity),
	relatedEntities: Schema.Array(EntityDetailsRelatedEntity),
});

type ValidatedEntityDetails = typeof ValidatedEntityDetails.Type;

type RelatedEntityGroups = {
	inferred: ReadonlyArray<EntityDetailsRelatedEntity>;
	explicitBySlug: ReadonlyMap<string, ReadonlyArray<EntityDetailsRelatedEntity>>;
};

const activityNameWithPrefix = (prefix: string | undefined) => (name: string) =>
	prefix ? `${prefix}${name}` : name;

const checkExistingEntity = Effect.fn("checkExistingEntity")(function* (
	payload: EntityImportPayload,
	activityName: ActivityName,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* EntitiesRepository;

	return yield* Activity.make({
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
});

const validateEntityDetails = Effect.fn("validateEntityDetails")(function* (
	value: unknown,
	activityName: ActivityName,
) {
	return yield* Activity.make({
		error: SandboxRunError,
		success: ValidatedEntityDetails,
		name: activityName("validate-entity-details"),
		execute: Effect.gen(function* () {
			const details = yield* decodeEntityDetailsResult(value).pipe(
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
});

const groupRelatedEntities = (
	relatedEntities: ReadonlyArray<EntityDetailsRelatedEntity>,
): RelatedEntityGroups => {
	const inferred = relatedEntities.filter(
		(relatedEntity) => relatedEntity.relationshipSchemaSlug === undefined,
	);
	const explicitBySlug = new Map<string, EntityDetailsRelatedEntity[]>();

	for (const relatedEntity of relatedEntities) {
		if (relatedEntity.relationshipSchemaSlug === undefined) {
			continue;
		}

		const group = explicitBySlug.get(relatedEntity.relationshipSchemaSlug);
		if (group) {
			group.push(relatedEntity);
		} else {
			explicitBySlug.set(relatedEntity.relationshipSchemaSlug, [relatedEntity]);
		}
	}

	return { inferred, explicitBySlug };
};

const writePrimaryEntity = Effect.fn("writePrimaryEntity")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	activityName: ActivityName,
) {
	const entities = yield* EntitiesService;

	return yield* Activity.make({
		success: ListedEntity,
		error: SandboxRunError,
		name: activityName("write-primary-entity"),
		execute: entities
			.save({
				scope: "global",
				populatedAt: null,
				name: details.name,
				externalId: payload.externalId,
				sandboxScriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
				properties: details.properties,
			})
			.pipe(
				dieOnDbError,
				Effect.mapError((error) => new SandboxRunError({ message: error.message })),
			),
	});
});

const writeRelatedEntities = Effect.fn("writeRelatedEntities")(function* (
	payload: EntityImportPayload,
	entity: ListedEntity,
	groups: RelatedEntityGroups,
	activityName: ActivityName,
) {
	yield* Effect.forEach(
		groups.inferred,
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

	yield* Effect.forEach(
		[...groups.explicitBySlug.entries()],
		([relationshipSchemaSlug, relatedEntities]) =>
			Activity.make({
				error: SandboxRunError,
				name: activityName(`sync-related-${relationshipSchemaSlug}`),
				execute: syncRelatedEntitiesByRelationshipSchema({
					relatedEntities,
					relationshipSchemaSlug,
					sourceEntityId: entity.id,
				}),
			}),
		{ discard: true },
	);
});

const writeChildEntities = Effect.fn("writeChildEntities")(function* (
	payload: EntityImportPayload,
	entity: ListedEntity,
	details: ValidatedEntityDetails,
	activityName: ActivityName,
) {
	yield* processChildEntityTree({
		parentEntityId: entity.id,
		sandboxScriptId: payload.scriptId,
		activityPrefix: activityName(""),
		parentEntitySchemaId: payload.entitySchemaId,
		childEntities: details.childEntities,
	});
});

const markPrimaryEntityPopulated = Effect.fn("markPrimaryEntityPopulated")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	activityName: ActivityName,
) {
	const redis = yield* RedisService;
	const entities = yield* EntitiesService;

	return yield* Activity.make({
		success: ListedEntity,
		error: SandboxRunError,
		name: activityName("mark-primary-entity-populated"),
		execute: Effect.gen(function* () {
			const populatedAt = yield* DateTime.nowAsDate;
			const saved = yield* entities
				.save({
					populatedAt,
					scope: "global",
					name: details.name,
					externalId: payload.externalId,
					sandboxScriptId: payload.scriptId,
					entitySchemaId: payload.entitySchemaId,
					properties: details.properties,
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
});

export const runEntityImportWorkflow = Effect.fn("runEntityImportWorkflow")(function* (
	payload: EntityImportPayload,
	executionId: string,
	options: { activityPrefix?: string } = {},
) {
	const operations = yield* EntityImportWorkflowOperations;
	const activityName = activityNameWithPrefix(options.activityPrefix);

	const existing = yield* checkExistingEntity(payload, activityName);
	if (existing && existing.populatedAt !== null) {
		return existing;
	}

	const sandboxResult = yield* operations.processSandbox(payload, executionId);
	if (sandboxResult.error) {
		return yield* new SandboxRunError({ message: sandboxResult.error });
	}

	const details = yield* validateEntityDetails(sandboxResult.value, activityName);
	const relatedEntities = groupRelatedEntities(details.relatedEntities);
	const entity = yield* writePrimaryEntity(payload, details, activityName);

	yield* writeRelatedEntities(payload, entity, relatedEntities, activityName);
	yield* writeChildEntities(payload, entity, details, activityName);

	return yield* markPrimaryEntityPopulated(payload, details, activityName);
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
