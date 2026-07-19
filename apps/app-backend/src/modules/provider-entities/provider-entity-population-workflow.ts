import { SandboxRunError, mapDbErrorToSandbox } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import type { EntityId, EntitySchemaSlug } from "@ryot/contract/schema/brands";
import type {
	ProviderDetailsChildEntity,
	ProviderDetailsRelatedEntityGroup,
} from "@ryot/sandbox-sdk/provider";
import { sha256Base64Url } from "@ryot/ts-utils/crypto";
import { stableStringify } from "@ryot/ts-utils/json";
import { asRecord } from "@ryot/ts-utils/predicates";
import { Cause, DateTime, Effect, Schedule, Schema } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import {
	LifecycleDispatch,
	type LifecyclePopulationContext,
} from "#modules/entities/lifecycle-dispatch";
import { ProviderEntitySaveResult } from "#modules/entities/mutation-outcomes";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import {
	RelationshipMutationOutcomes,
	type RelationshipMutationOutcome,
	type RelationshipMutationSnapshot,
} from "#modules/relationships/mutation-outcomes";
import {
	ProviderDetailsChildEntitySchema,
	ProviderDetailsRelatedEntityGroupSchema,
	SandboxJsonValueSchema,
	decodeProviderDetailsResult,
} from "#modules/sandbox/provider-contracts";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { ChildEntitySetWriteResult, writeChildEntitySet } from "./population";
import { syncRelatedEntityGroup } from "./relationship-population";
import { EntityImportPayload } from "./schemas";

const REDIS_RETRY_SCHEDULE = Schedule.spaced("30 seconds");

type SynchronizeOptions = {
	entitySchemaSlug: EntitySchemaSlug;
	mode: "initial" | "refresh";
};

const ValidatedEntityDetails = Schema.Struct({
	name: Schema.String,
	properties: SandboxJsonValueSchema,
	expectedChildEntitySchemaSlug: Schema.optional(Schema.String),
	childEntities: Schema.Array(ProviderDetailsChildEntitySchema),
	relatedEntityGroups: Schema.Array(ProviderDetailsRelatedEntityGroupSchema),
});

type ValidatedEntityDetails = typeof ValidatedEntityDetails.Type;

const SandboxJsonObjectSchema = Schema.Record(Schema.String, SandboxJsonValueSchema);

type ChildEntitySetScope = {
	parentName: string;
	parentEntityId: EntityId;
	parentExternalId: string;
	parentProperties: unknown;
	parentEntitySchemaSlug: EntitySchemaSlug;
	scopeEntity: LifecyclePopulationContext["scopeEntity"];
	childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
	expectedChildEntitySchemaSlug?: string;
};

const ProviderEntitySaveEnvelope = Schema.Struct({
	committedAt: Schema.String,
	result: ProviderEntitySaveResult,
});

const RelationshipSyncEnvelope = Schema.Struct({
	committedAt: Schema.String,
	outcomes: RelationshipMutationOutcomes,
});

const checkExistingEntity = Effect.fn("checkExistingEntity")(function* (
	payload: EntityImportPayload,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* EntitiesRepository;

	return yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		name: "check-existing-entity",
		success: Schema.NullOr(ListedEntity) satisfies DurableSchema,
		execute: runWithDb(
			repository.findGlobalEntityByExternalId({
				externalId: payload.externalId,
				providerId: payload.providerId,
				entitySchemaSlug: payload.entitySchemaSlug,
			}),
		).pipe(mapDbErrorToSandbox),
	});
});

const validateEntityDetails = Effect.fn("validateEntityDetails")(function* (value: unknown) {
	return yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		success: ValidatedEntityDetails satisfies DurableSchema,
		name: "validate-entity-details",
		execute: Effect.gen(function* () {
			const details = yield* decodeProviderDetailsResult(value).pipe(
				Effect.mapError(
					(error) => new SandboxRunError({ message: `Invalid entity details: ${error.message}` }),
				),
			);

			return {
				name: details.name,
				properties: details.properties,
				...(details.expectedChildEntitySchemaSlug
					? { expectedChildEntitySchemaSlug: details.expectedChildEntitySchemaSlug }
					: {}),
				childEntities: details.childEntities ?? [],
				relatedEntityGroups: details.relatedEntityGroups ?? [],
			};
		}),
	});
});

const upsertRootEntity = Effect.fn("upsertProviderRootEntity")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	options: SynchronizeOptions,
) {
	const entities = yield* EntitiesService;
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		name: "upsert-root-entity",
		success: ProviderEntitySaveEnvelope satisfies DurableSchema,
		// A brand-new or not-yet-populated entity is written with a null populatedAt so
		// children can reference it before the final stamp activity; refresh preserves an
		// already-populated entity until then. Initial population replaces the skeleton.
		execute: runInTransaction(
			Effect.gen(function* () {
				const result = yield* entities.upsert({
					populatedAt: null,
					name: details.name,
					externalId: payload.externalId,
					properties: details.properties,
					providerId: payload.providerId,
					entitySchemaSlug: payload.entitySchemaSlug,
					updateExisting: options.mode !== "refresh",
				});
				return { result, committedAt: (yield* DateTime.nowAsDate).toISOString() };
			}),
		).pipe(mapDbErrorToSandbox),
	});
});

const syncRelatedEntityGroupScope = Effect.fn("syncProviderRelatedEntityGroupScope")(function* (
	payload: EntityImportPayload,
	entity: ListedEntity,
	group: ProviderDetailsRelatedEntityGroup,
	index: number,
) {
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		success: RelationshipSyncEnvelope satisfies DurableSchema,
		name: `sync-related-entity-group:${index}:${group.relationshipSchemaSlug}`,
		execute: runInTransaction(
			Effect.gen(function* () {
				const outcomes = yield* syncRelatedEntityGroup({
					group,
					primaryEntityId: entity.id,
					primaryEntitySchemaSlug: payload.entitySchemaSlug,
				});
				return { outcomes, committedAt: (yield* DateTime.nowAsDate).toISOString() };
			}),
		).pipe(mapDbErrorToSandbox),
	});
});

const writeChildEntitySetScope = Effect.fn("writeChildEntitySetScope")(function* (
	payload: EntityImportPayload,
	options: SynchronizeOptions,
	scope: ChildEntitySetScope,
) {
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		success: ChildEntitySetWriteResult satisfies DurableSchema,
		name: `write-child-entity-set:${scope.parentExternalId}`,
		execute: runInTransaction(
			writeChildEntitySet({
				providerId: payload.providerId,
				childEntities: scope.childEntities,
				parentEntityId: scope.parentEntityId,
				syncExisting: options.mode === "refresh",
				parentEntitySchemaSlug: scope.parentEntitySchemaSlug,
				expectedChildEntitySchemaSlug: scope.expectedChildEntitySchemaSlug,
			}),
		).pipe(mapDbErrorToSandbox),
	});
});

const stampRootPopulatedAt = Effect.fn("stampProviderRootPopulatedAt")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
) {
	const entities = yield* EntitiesService;
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		name: "stamp-root-populated-at",
		success: ProviderEntitySaveEnvelope satisfies DurableSchema,
		execute: runInTransaction(
			Effect.gen(function* () {
				const populatedAt = yield* DateTime.nowAsDate;
				const result = yield* entities.upsert({
					populatedAt,
					name: details.name,
					updateExisting: true,
					properties: details.properties,
					externalId: payload.externalId,
					providerId: payload.providerId,
					entitySchemaSlug: payload.entitySchemaSlug,
				});
				return { result, committedAt: (yield* DateTime.nowAsDate).toISOString() };
			}),
		).pipe(mapDbErrorToSandbox),
	});
});

const publishPrimaryEntity = Effect.fn("publishProviderPrimaryEntity")(function* (
	entity: ListedEntity,
) {
	const redis = yield* RedisService;

	yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		name: "publish-primary-entity",
		execute: redis
			.publish(redisKeys.entityUpdatedChannel, encodeEntityUpdatedMessage(entity.id, "populated"))
			.pipe(
				Effect.asVoid,
				Effect.sandbox,
				Effect.retry({
					schedule: REDIS_RETRY_SCHEDULE,
					while: (cause) => !Cause.hasInterrupts(cause),
				}),
				Effect.catch((cause) => Effect.failCause(cause)),
			),
	});
});

const shouldWriteChildEntitySet = (options: SynchronizeOptions, scope: ChildEntitySetScope) =>
	scope.childEntities.length > 0 ||
	(options.mode === "refresh" && scope.expectedChildEntitySchemaSlug !== undefined);

const toSandboxJsonObject = (value: unknown) =>
	Schema.is(SandboxJsonObjectSchema)(value) ? value : {};

const toLifecycleSnapshot = (snapshot: ProviderEntitySaveResult["outcome"]["after"]) => ({
	...snapshot,
	properties: asRecord(snapshot.properties) ?? {},
});

const toLifecycleRelationshipSnapshot = (snapshot: RelationshipMutationSnapshot) => ({
	id: snapshot.id,
	source: snapshot.sourceEntity,
	target: snapshot.targetEntity,
	relationshipSchemaSlug: snapshot.relationshipSchemaSlug,
	properties: asRecord(snapshot.properties) ?? {},
});

const deterministicId = (prefix: string, parts: ReadonlyArray<string>) =>
	`${prefix}_${sha256Base64Url(stableStringify(parts))}`;

const relationshipSnapshot = (outcome: RelationshipMutationOutcome) =>
	outcome.after ?? outcome.before;

const relationshipMutationIdentity = (outcome: RelationshipMutationOutcome) => {
	const snapshot = relationshipSnapshot(outcome);
	return stableStringify([
		snapshot.relationshipSchemaSlug,
		snapshot.sourceEntity.id,
		snapshot.targetEntity.id,
		outcome.operation,
	]);
};

const dispatchEntityMutation = Effect.fn("dispatchProviderEntityMutation")(function* (input: {
	phase: string;
	committedAt: string;
	executionId: string;
	result: ProviderEntitySaveResult;
	origin: EntityImportPayload["origin"];
	population: LifecyclePopulationContext;
}) {
	if (input.result.outcome.operation === "noop") {
		return;
	}
	const lifecycleDispatch = yield* LifecycleDispatch;
	const outcome = input.result.outcome;
	yield* lifecycleDispatch
		.dispatch({
			rowUserId: null,
			origin: input.origin,
			operation: outcome.operation,
			population: input.population,
			occurredAt: input.committedAt,
			recordId: input.result.entity.id,
			occurrenceId: `${input.executionId}:entity:${input.phase}:${input.result.entity.id}:${outcome.operation}`,
			source: {
				kind: "entity",
				after: toLifecycleSnapshot(outcome.after),
				...(outcome.before ? { before: toLifecycleSnapshot(outcome.before) } : {}),
			},
		})
		.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
});

const dispatchRelationshipSync = Effect.fn("dispatchProviderRelationshipSync")(function* (input: {
	committedAt: string;
	executionId: string;
	anchorEntityId: EntityId;
	direction: "incoming" | "outgoing";
	origin: EntityImportPayload["origin"];
	outcomes: ReadonlyArray<RelationshipMutationOutcome>;
	population: Omit<LifecyclePopulationContext, "batch">;
}) {
	const material = input.outcomes.filter((outcome) => outcome.operation !== "noop");
	if (material.length === 0) {
		return;
	}
	const [firstOutcome] = material;
	if (!firstOutcome) {
		return;
	}
	const first = relationshipSnapshot(firstOutcome);
	const leaderIdentity = material.reduce((leader, outcome) => {
		const identity = relationshipMutationIdentity(outcome);
		return identity < leader ? identity : leader;
	}, relationshipMutationIdentity(firstOutcome));
	const batchId = deterministicId("relationship_batch", [
		input.executionId,
		first.relationshipSchemaSlug,
		input.direction,
		input.anchorEntityId,
	]);
	const batch = {
		id: batchId,
		afterCount: input.outcomes.filter(({ after }) => after !== null).length,
		beforeCount: input.outcomes.filter(({ before }) => before !== null).length,
		createdCount: material.filter(({ operation }) => operation === "create").length,
		deletedCount: material.filter(({ operation }) => operation === "delete").length,
		updatedCount: material.filter(({ operation }) => operation === "update").length,
	};
	const lifecycleDispatch = yield* LifecycleDispatch;
	for (const outcome of material) {
		const snapshot = relationshipSnapshot(outcome);
		const occurrenceId = deterministicId("relationship_occurrence", [
			input.executionId,
			snapshot.relationshipSchemaSlug,
			input.direction,
			snapshot.sourceEntity.id,
			snapshot.targetEntity.id,
			outcome.operation,
		]);
		yield* lifecycleDispatch
			.dispatch({
				occurrenceId,
				rowUserId: null,
				origin: input.origin,
				operation: outcome.operation,
				occurredAt: input.committedAt,
				recordId: snapshot.id,
				population: {
					...input.population,
					batch: { ...batch, isLeader: relationshipMutationIdentity(outcome) === leaderIdentity },
				},
				source: {
					kind: "relationship",
					...(outcome.after ? { after: toLifecycleRelationshipSnapshot(outcome.after) } : {}),
					...(outcome.before ? { before: toLifecycleRelationshipSnapshot(outcome.before) } : {}),
				},
			})
			.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
	}
});

const writeChildEntityScopes = Effect.fn("writeChildEntityScopes")(function* (
	payload: EntityImportPayload,
	executionId: string,
	options: SynchronizeOptions,
	rootPreviouslyPopulated: boolean,
	rootScope: ChildEntitySetScope,
) {
	const pending: ChildEntitySetScope[] = [rootScope];
	let scope: ChildEntitySetScope | undefined;
	while ((scope = pending.shift()) !== undefined) {
		if (!shouldWriteChildEntitySet(options, scope)) {
			continue;
		}
		const processed = yield* writeChildEntitySetScope(payload, options, scope);
		const parentEntity = {
			name: scope.parentName,
			properties: toSandboxJsonObject(scope.parentProperties),
			entitySchemaSlug: scope.parentEntitySchemaSlug,
		};
		yield* dispatchRelationshipSync({
			executionId,
			direction: "outgoing",
			origin: payload.origin,
			committedAt: processed.committedAt,
			anchorEntityId: scope.parentEntityId,
			outcomes: processed.relationshipOutcomes,
			population: {
				parentEntity,
				rootPreviouslyPopulated,
				scopeEntity: scope.scopeEntity,
			},
		});
		for (const [index, childEntity] of scope.childEntities.entries()) {
			const child = processed.processedChildren[index];
			if (!child) {
				continue;
			}
			yield* dispatchEntityMutation({
				executionId,
				origin: payload.origin,
				committedAt: processed.committedAt,
				phase: `children:${scope.parentExternalId}`,
				result: { entity: child.entity, outcome: child.entityOutcome },
				population: {
					parentEntity,
					rootPreviouslyPopulated,
					scopeEntity: scope.scopeEntity,
				},
			});
			pending.push({
				parentName: child.entity.name,
				scopeEntity: scope.scopeEntity,
				parentEntityId: child.entity.id,
				parentExternalId: childEntity.externalId,
				parentProperties: child.entity.properties,
				parentEntitySchemaSlug: child.entitySchemaSlug,
				childEntities: childEntity.childEntities ?? [],
				...(childEntity.expectedChildEntitySchemaSlug
					? { expectedChildEntitySchemaSlug: childEntity.expectedChildEntitySchemaSlug }
					: {}),
			});
		}
	}
});

const synchronizeEntityGraph = Effect.fn("synchronizeEntityGraph")(function* (
	payload: EntityImportPayload,
	executionId: string,
	options: SynchronizeOptions,
	rootPreviouslyPopulated: boolean,
) {
	const operations = yield* EntityImportWorkflowOperations;
	const sandboxResult = yield* operations.processSandbox(payload, executionId);
	if (sandboxResult.error) {
		return yield* new SandboxRunError({ message: sandboxResult.error.message });
	}

	const details = yield* validateEntityDetails(sandboxResult.value);
	const rootSave = yield* upsertRootEntity(payload, details, options);
	const entity = rootSave.result.entity;
	const scopeEntity = {
		id: entity.id,
		name: details.name,
		entitySchemaSlug: rootSave.result.outcome.after.entitySchemaSlug,
	};
	yield* dispatchEntityMutation({
		executionId,
		phase: "root-upsert",
		origin: payload.origin,
		result: rootSave.result,
		committedAt: rootSave.committedAt,
		population: { scopeEntity, rootPreviouslyPopulated },
	});
	for (const [index, group] of details.relatedEntityGroups.entries()) {
		const synced = yield* syncRelatedEntityGroupScope(payload, entity, group, index);
		yield* dispatchRelationshipSync({
			executionId,
			origin: payload.origin,
			anchorEntityId: entity.id,
			outcomes: synced.outcomes,
			direction: group.direction,
			committedAt: synced.committedAt,
			population: { scopeEntity, rootPreviouslyPopulated },
		});
	}
	yield* writeChildEntityScopes(payload, executionId, options, rootPreviouslyPopulated, {
		scopeEntity,
		parentName: entity.name,
		parentEntityId: entity.id,
		parentProperties: entity.properties,
		parentExternalId: payload.externalId,
		childEntities: details.childEntities,
		parentEntitySchemaSlug: options.entitySchemaSlug,
		...(details.expectedChildEntitySchemaSlug
			? { expectedChildEntitySchemaSlug: details.expectedChildEntitySchemaSlug }
			: {}),
	});
	const stamped = yield* stampRootPopulatedAt(payload, details);
	yield* dispatchEntityMutation({
		executionId,
		phase: "root-stamp",
		origin: payload.origin,
		result: stamped.result,
		committedAt: stamped.committedAt,
		population: { scopeEntity, rootPreviouslyPopulated },
	});
	yield* publishPrimaryEntity(stamped.result.entity);
	return stamped.result.entity;
});

export const ProviderEntityPopulationPayload = Schema.Struct({
	...EntityImportPayload.fields,
	mode: Schema.Literals(["ensure", "refresh"]),
});

export type ProviderEntityPopulationPayload = typeof ProviderEntityPopulationPayload.Type;

export const ProviderEntityPopulationWorkflow = Workflow.make("ProviderEntityPopulationWorkflow", {
	success: ListedEntity satisfies DurableSchema,
	error: SandboxRunError satisfies DurableSchema,
	payload: ProviderEntityPopulationPayload satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
});

// Exported for unit testing only. Production callers must dispatch
// `ProviderEntityPopulationWorkflow` via the workflow engine; the
// workflow-boundaries test enforces that this handler is never imported
// by production modules.
export const runProviderEntityPopulationWorkflow = Effect.fn("ProviderEntityPopulationWorkflow")(
	function* (payload: ProviderEntityPopulationPayload, executionId: string) {
		if (payload.mode === "refresh" && !payload.entitySchemaSlug) {
			return yield* Effect.die("entitySchemaSlug is required for refresh");
		}
		yield* Effect.annotateCurrentSpan({
			executionId,
			providerId: payload.providerId,
			externalId: payload.externalId,
			entitySchemaSlug: payload.entitySchemaSlug,
			...(payload.userId ? { userId: payload.userId } : {}),
		});
		const existing = yield* checkExistingEntity(payload);
		const rootPreviouslyPopulated = existing !== null && existing.populatedAt !== null;
		if (payload.mode === "ensure") {
			if (existing && existing.populatedAt !== null) {
				return existing;
			}
			return yield* synchronizeEntityGraph(
				payload,
				executionId,
				{ mode: "initial", entitySchemaSlug: payload.entitySchemaSlug },
				rootPreviouslyPopulated,
			);
		}

		return yield* synchronizeEntityGraph(
			payload,
			executionId,
			{ mode: "refresh", entitySchemaSlug: payload.entitySchemaSlug },
			rootPreviouslyPopulated,
		);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProviderEntityPopulationWorkflow" }),
);

const ProviderEntityPopulationWorkflowLive = ProviderEntityPopulationWorkflow.toLayer(
	runProviderEntityPopulationWorkflow,
);

export const ProviderEntityPopulationWorkflowDefinitionsLive = ProviderEntityPopulationWorkflowLive;
