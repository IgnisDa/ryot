import { SandboxRunError, mapDbErrorToSandbox } from "@ryot-app/contract/errors";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-interest/messages";
import type { EntityId, EntitySchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import {
	providerDetailsChildEntitySchema,
	providerDetailsRelatedEntityGroupSchema,
	providerDetailsResultSchema,
	type ProviderDetailsChildEntity,
	type ProviderDetailsRelatedEntityGroup,
} from "@ryot-app/sandbox-sdk/provider";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { asRecord } from "@ryot-app/ts-utils/predicates";
import { Cause, DateTime, Effect, Schedule, Schema } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { DefinitionRegistry, DefinitionSnapshot } from "#modules/definition-registry/service";
import {
	LifecycleDispatch,
	type LifecyclePopulationContext,
} from "#modules/entities/lifecycle-dispatch";
import { ProviderEntitySaveResult } from "#modules/entities/mutation-outcomes";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import {
	RelationshipMutationOutcomes,
	type RelationshipMutationOutcome,
	type RelationshipMutationSnapshot,
} from "#modules/relationships/mutation-outcomes";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { ChildEntitySetWriteResult, writeChildEntitySet } from "./population";
import { syncRelatedEntityGroup } from "./relationship-population";
import type { EntityImportPayload } from "./schemas";
import { EntityImportScope, entityImportPayloadFields } from "./schemas";

const REDIS_RETRY_SCHEDULE = Schedule.spaced("30 seconds");

type SynchronizeOptions = { mode: "initial" | "refresh"; entitySchemaSlug: EntitySchemaSlug };

const ValidatedEntityDetails = Schema.Struct({
	name: Schema.String,
	properties: jsonValueSchema,
	expectedChildEntitySchemaSlug: Schema.optional(Schema.String),
	childEntities: Schema.Array(providerDetailsChildEntitySchema),
	relatedEntityGroups: Schema.Array(providerDetailsRelatedEntityGroupSchema),
});

type ValidatedEntityDetails = typeof ValidatedEntityDetails.Type;

const SandboxJsonObjectSchema = Schema.Record(Schema.String, jsonValueSchema);
const decodeProviderDetailsResult = Schema.decodeUnknownEffect(providerDetailsResultSchema);

type ChildEntitySetScope = {
	parentName: string;
	parentEntityId: EntityId;
	parentExternalId: string;
	parentProperties: unknown;
	expectedChildEntitySchemaSlug?: string;
	parentEntitySchemaSlug: EntitySchemaSlug;
	scopeEntity: LifecyclePopulationContext["scopeEntity"];
	childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
};

const ProviderEntitySaveEnvelope = Schema.Struct({
	committedAt: Schema.String,
	result: ProviderEntitySaveResult,
});

const RelationshipSyncEnvelope = Schema.Struct({
	committedAt: Schema.String,
	outcomes: RelationshipMutationOutcomes,
});

const resolveProviderEntityDefinitions = (
	entityScope: { scope: "global" } | { scope: "user"; userId: UserId },
) =>
	Activity.make({
		name: "resolve-provider-entity-definitions",
		error: SandboxRunError satisfies DurableSchema,
		success: DefinitionSnapshot satisfies DurableSchema,
		execute: Effect.gen(function* () {
			if (entityScope.scope === "user") {
				return yield* Effect.flatMap(PluginRuntimeResolver, (runtime) =>
					runtime.getEffectiveDefinitions(entityScope.userId),
				).pipe(mapDbErrorToSandbox);
			}
			return (yield* DefinitionRegistry).getSnapshot();
		}),
	});

const checkExistingEntity = Effect.fn("checkExistingEntity")(function* (
	payload: EntityImportPayload,
	entityScope: { scope: "global" } | { scope: "user"; userId: UserId },
	definitions: DefinitionSnapshot,
) {
	const repository = yield* EntitiesRepository;
	const schema = definitions.entitySchemas[payload.entitySchemaSlug];
	if (!schema) {
		return yield* new SandboxRunError({ message: "Entity schema not found" });
	}

	return yield* Activity.make({
		name: "check-existing-entity",
		error: SandboxRunError satisfies DurableSchema,
		success: Schema.NullOr(ListedEntity) satisfies DurableSchema,
		execute: repository
			.findEntityByExternalId({
				...entityScope,
				externalId: payload.externalId,
				providerId: payload.providerId,
				entitySchemaSlug: payload.entitySchemaSlug,
				entitySchemaPluginId: schema.pluginId ?? null,
			})
			.pipe(mapDbErrorToSandbox),
	});
});

const validateEntityDetails = Effect.fn("validateEntityDetails")(function* (value: unknown) {
	return yield* Activity.make({
		name: "validate-entity-details",
		error: SandboxRunError satisfies DurableSchema,
		success: ValidatedEntityDetails satisfies DurableSchema,
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

const getEntityWriteScope = (payload: EntityImportPayload) =>
	payload.entityScope.type === "user"
		? ({ scope: "user", userId: payload.entityScope.userId } as const)
		: ({ scope: "global" } as const);

const upsertRootEntity = Effect.fn("upsertProviderRootEntity")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	options: SynchronizeOptions,
) {
	const database = yield* Database;
	const entities = yield* EntitiesService;
	const scope = getEntityWriteScope(payload);

	return yield* Activity.make({
		name: "upsert-root-entity",
		error: SandboxRunError satisfies DurableSchema,
		success: ProviderEntitySaveEnvelope satisfies DurableSchema,
		// A brand-new or not-yet-populated entity is written with a null populatedAt so
		// children can reference it before the final stamp activity; refresh preserves an
		// already-populated entity until then. Initial population replaces the skeleton.
		execute: mapDatabaseErrors(
			database.transaction((transaction) =>
				Effect.gen(function* () {
					const result = yield* entities.upsert({
						...scope,
						populatedAt: null,
						name: details.name,
						externalId: payload.externalId,
						properties: details.properties,
						providerId: payload.providerId,
						entitySchemaSlug: payload.entitySchemaSlug,
						updateExisting: options.mode !== "refresh",
					});
					return { result, committedAt: (yield* DateTime.nowAsDate).toISOString() };
				}).pipe(Effect.provideService(Database, transaction)),
			),
		).pipe(mapDbErrorToSandbox),
	});
});

const syncRelatedEntityGroupScope = Effect.fn("syncProviderRelatedEntityGroupScope")(function* (
	payload: EntityImportPayload,
	definitions: DefinitionSnapshot,
	entity: ListedEntity,
	group: ProviderDetailsRelatedEntityGroup,
	index: number,
) {
	const database = yield* Database;
	const entityScope = getEntityWriteScope(payload);
	return yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		success: RelationshipSyncEnvelope satisfies DurableSchema,
		name: `sync-related-entity-group:${index}:${group.relationshipSchemaSlug}`,
		execute: mapDatabaseErrors(
			database.transaction((transaction) =>
				Effect.gen(function* () {
					const outcomes = yield* syncRelatedEntityGroup({
						...entityScope,
						group,
						definitions,
						primaryEntityId: entity.id,
						primaryEntitySchemaSlug: payload.entitySchemaSlug,
					});
					return { outcomes, committedAt: (yield* DateTime.nowAsDate).toISOString() };
				}).pipe(Effect.provideService(Database, transaction)),
			),
		).pipe(mapDbErrorToSandbox),
	});
});

const writeChildEntitySetScope = Effect.fn("writeChildEntitySetScope")(function* (
	payload: EntityImportPayload,
	definitions: DefinitionSnapshot,
	options: SynchronizeOptions,
	scope: ChildEntitySetScope,
) {
	const database = yield* Database;
	const entityScope = getEntityWriteScope(payload);
	return yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		name: `write-child-entity-set:${scope.parentExternalId}`,
		success: ChildEntitySetWriteResult satisfies DurableSchema,
		execute: mapDatabaseErrors(
			database.transaction((transaction) =>
				writeChildEntitySet({
					...entityScope,
					definitions,
					providerId: payload.providerId,
					childEntities: scope.childEntities,
					parentEntityId: scope.parentEntityId,
					syncExisting: options.mode === "refresh",
					parentEntitySchemaSlug: scope.parentEntitySchemaSlug,
					expectedChildEntitySchemaSlug: scope.expectedChildEntitySchemaSlug,
				}).pipe(Effect.provideService(Database, transaction)),
			),
		).pipe(mapDbErrorToSandbox),
	});
});

const stampRootPopulatedAt = Effect.fn("stampProviderRootPopulatedAt")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
) {
	const database = yield* Database;
	const entities = yield* EntitiesService;
	const scope = getEntityWriteScope(payload);

	return yield* Activity.make({
		name: "stamp-root-populated-at",
		error: SandboxRunError satisfies DurableSchema,
		success: ProviderEntitySaveEnvelope satisfies DurableSchema,
		execute: mapDatabaseErrors(
			database.transaction((transaction) =>
				Effect.gen(function* () {
					const populatedAt = yield* DateTime.nowAsDate;
					const result = yield* entities.upsert({
						...scope,
						populatedAt,
						name: details.name,
						updateExisting: true,
						properties: details.properties,
						externalId: payload.externalId,
						providerId: payload.providerId,
						entitySchemaSlug: payload.entitySchemaSlug,
					});
					return { result, committedAt: (yield* DateTime.nowAsDate).toISOString() };
				}).pipe(Effect.provideService(Database, transaction)),
			),
		).pipe(mapDbErrorToSandbox),
	});
});

const publishPrimaryEntity = Effect.fn("publishProviderPrimaryEntity")(function* (
	entity: ListedEntity,
) {
	const redis = yield* RedisService;

	yield* Activity.make({
		name: "publish-primary-entity",
		error: SandboxRunError satisfies DurableSchema,
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
	properties: asRecord(snapshot.properties) ?? {},
	relationshipSchemaSlug: snapshot.relationshipSchemaSlug,
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
	rowUserId: EntityImportPayload["entityScope"]["userId"];
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
			origin: input.origin,
			rowUserId: input.rowUserId,
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
	rowUserId: EntityImportPayload["entityScope"]["userId"];
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
				origin: input.origin,
				recordId: snapshot.id,
				rowUserId: input.rowUserId,
				operation: outcome.operation,
				occurredAt: input.committedAt,
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
	definitions: DefinitionSnapshot,
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
		const processed = yield* writeChildEntitySetScope(payload, definitions, options, scope);
		const rowUserId = payload.entityScope.type === "user" ? payload.entityScope.userId : null;
		const parentEntity = {
			name: scope.parentName,
			entitySchemaSlug: scope.parentEntitySchemaSlug,
			properties: toSandboxJsonObject(scope.parentProperties),
		};
		yield* dispatchRelationshipSync({
			rowUserId,
			executionId,
			direction: "outgoing",
			origin: payload.origin,
			committedAt: processed.committedAt,
			anchorEntityId: scope.parentEntityId,
			outcomes: processed.relationshipOutcomes,
			population: { parentEntity, rootPreviouslyPopulated, scopeEntity: scope.scopeEntity },
		});
		for (const [index, childEntity] of scope.childEntities.entries()) {
			const child = processed.processedChildren[index];
			if (!child) {
				continue;
			}
			yield* dispatchEntityMutation({
				rowUserId,
				executionId,
				origin: payload.origin,
				committedAt: processed.committedAt,
				phase: `children:${scope.parentExternalId}`,
				result: { entity: child.entity, outcome: child.entityOutcome },
				population: { parentEntity, rootPreviouslyPopulated, scopeEntity: scope.scopeEntity },
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
	definitions: DefinitionSnapshot,
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
	const rowUserId = payload.entityScope.type === "user" ? payload.entityScope.userId : null;
	const entity = rootSave.result.entity;
	const scopeEntity = {
		id: entity.id,
		name: details.name,
		entitySchemaSlug: rootSave.result.outcome.after.entitySchemaSlug,
	};
	yield* dispatchEntityMutation({
		rowUserId,
		executionId,
		phase: "root-upsert",
		origin: payload.origin,
		result: rootSave.result,
		committedAt: rootSave.committedAt,
		population: { scopeEntity, rootPreviouslyPopulated },
	});
	for (const [index, group] of details.relatedEntityGroups.entries()) {
		const synced = yield* syncRelatedEntityGroupScope(payload, definitions, entity, group, index);
		yield* dispatchRelationshipSync({
			rowUserId,
			executionId,
			origin: payload.origin,
			anchorEntityId: entity.id,
			outcomes: synced.outcomes,
			direction: group.direction,
			committedAt: synced.committedAt,
			population: { scopeEntity, rootPreviouslyPopulated },
		});
	}
	yield* writeChildEntityScopes(
		payload,
		definitions,
		executionId,
		options,
		rootPreviouslyPopulated,
		{
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
		},
	);
	const stamped = yield* stampRootPopulatedAt(payload, details);
	yield* dispatchEntityMutation({
		rowUserId,
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
	...entityImportPayloadFields,
	entityScope: EntityImportScope,
	mode: Schema.Literals(["ensure", "refresh"]),
});

export type ProviderEntityPopulationPayload = typeof ProviderEntityPopulationPayload.Type;

export const ProviderEntityPopulationWorkflow = Workflow.make("ProviderEntityPopulationWorkflow", {
	success: ListedEntity satisfies DurableSchema,
	error: SandboxRunError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: ProviderEntityPopulationPayload satisfies DurableSchema,
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
			...(payload.entityScope.userId ? { userId: payload.entityScope.userId } : {}),
		});
		const entityScope = getEntityWriteScope(payload);
		const definitions = yield* resolveProviderEntityDefinitions(entityScope);
		const existing = yield* checkExistingEntity(payload, entityScope, definitions);
		const rootPreviouslyPopulated = existing !== null && existing.populatedAt !== null;
		if (payload.mode === "ensure") {
			if (existing && existing.populatedAt !== null) {
				return existing;
			}
			return yield* synchronizeEntityGraph(
				payload,
				definitions,
				executionId,
				{ mode: "initial", entitySchemaSlug: payload.entitySchemaSlug },
				rootPreviouslyPopulated,
			);
		}

		return yield* synchronizeEntityGraph(
			payload,
			definitions,
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
