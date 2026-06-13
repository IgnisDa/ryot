import { Activity } from "@effect/workflow";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import { DateTime, Effect, Schema } from "effect";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { EntitiesService } from "#modules/entities/service";

import type { EntityImportPayload } from "./entity-import-workflow";
import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	EntityDetailsChildEntity,
	EntityDetailsRelationshipGroup,
	decodeEntityDetailsResult,
	processChildEntityTree,
} from "./population";
import { syncRelatedEntityGroup } from "./relationship-population";

type ActivityName = (name: string) => string;

const ValidatedEntityDetails = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	childEntities: Schema.Array(EntityDetailsChildEntity),
	relatedEntityGroups: Schema.Array(EntityDetailsRelationshipGroup),
});

type ValidatedEntityDetails = typeof ValidatedEntityDetails.Type;

const activityNameWithPrefix = (prefix: string | undefined) => (name: string) =>
	prefix ? `${prefix}${name}` : name;

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
				relatedEntityGroups: details.relatedEntityGroups ?? [],
			};
		}),
	});
});

const writePrimaryEntity = Effect.fn("writeProviderPrimaryEntity")(function* (
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
				onConflict: "replaceExisting",
				externalId: payload.externalId,
				properties: details.properties,
				sandboxScriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
			})
			.pipe(
				dieOnDbError,
				Effect.mapError((error) => new SandboxRunError({ message: error.message })),
			),
	});
});

const writeRelatedEntities = Effect.fn("writeProviderRelatedEntities")(function* (
	payload: EntityImportPayload,
	entity: ListedEntity,
	groups: ReadonlyArray<EntityDetailsRelationshipGroup>,
	activityName: ActivityName,
) {
	yield* Effect.forEach(
		groups,
		(group) =>
			Activity.make({
				error: SandboxRunError,
				name: activityName(`sync-related-group-${group.relationshipSchemaSlug}-${group.direction}`),
				execute: syncRelatedEntityGroup({
					group,
					primaryEntityId: entity.id,
					primaryEntitySchemaId: payload.entitySchemaId,
				}),
			}),
		{ discard: true },
	);
});

const writeChildEntities = Effect.fn("writeProviderChildEntities")(function* (
	payload: EntityImportPayload,
	entity: ListedEntity,
	details: ValidatedEntityDetails,
	activityName: ActivityName,
	input: ProviderEntitySynchronizationOptions,
) {
	if (
		details.childEntities.length === 0 &&
		(!input.entitySchemaSlug || !input.childEntitySchemaSlugs?.[input.entitySchemaSlug])
	) {
		return;
	}
	yield* processChildEntityTree({
		parentEntityId: entity.id,
		sandboxScriptId: payload.scriptId,
		childEntities: details.childEntities,
		syncExisting: input.mode === "refresh",
		activityPrefix: activityName(""),
		parentEntitySchemaId: payload.entitySchemaId,
		parentEntitySchemaSlug: input.entitySchemaSlug,
		childEntitySchemaSlugs: input.childEntitySchemaSlugs,
	});
});

const markPrimaryEntityPopulated = Effect.fn("markProviderPrimaryEntityPopulated")(function* (
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
					onConflict: "replaceExisting",
					properties: details.properties,
					externalId: payload.externalId,
					sandboxScriptId: payload.scriptId,
					entitySchemaId: payload.entitySchemaId,
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

export type ProviderEntitySynchronizationOptions = {
	activityPrefix?: string;
	entitySchemaSlug?: string;
	mode: "initial" | "refresh";
	childEntitySchemaSlugs?: Readonly<Record<string, string>>;
};

export const synchronizeProviderEntity = Effect.fn("synchronizeProviderEntity")(function* (
	payload: EntityImportPayload,
	executionId: string,
	options: ProviderEntitySynchronizationOptions,
) {
	const operations = yield* EntityImportWorkflowOperations;
	const activityName = activityNameWithPrefix(options.activityPrefix);
	const sandboxResult = yield* operations.processSandbox(payload, executionId);
	if (sandboxResult.error) {
		return yield* new SandboxRunError({ message: sandboxResult.error });
	}

	const details = yield* validateEntityDetails(sandboxResult.value, activityName);
	const entity = yield* writePrimaryEntity(payload, details, activityName);
	yield* writeRelatedEntities(payload, entity, details.relatedEntityGroups, activityName);
	yield* writeChildEntities(payload, entity, details, activityName, options);

	return yield* markPrimaryEntityPopulated(payload, details, activityName);
});
