import { Activity, Workflow } from "@effect/workflow";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import type { EntityId, EntitySchemaId } from "@ryot/contract/schema/brands";
import type {
	ProviderDetailsChildEntity,
	ProviderDetailsRelatedEntityGroup,
} from "@ryot/sandbox-sdk/provider";
import { stableStringify } from "@ryot/ts-utils/json";
import { asRecord } from "@ryot/ts-utils/predicates";
import { Cause, DateTime, Effect, Schedule, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
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
	decodeProviderDetailsResult,
} from "#modules/sandbox/provider-contracts";

import { EntityImportPayload } from "./entity-import-workflow";
import { EntityImportWorkflowOperations } from "./operations-workflow";
import { ChildEntitySetWriteResult, writeChildEntitySet } from "./population";
import { syncRelatedEntityGroup } from "./relationship-population";

// Child schema hierarchy for provider container types. Only consulted during
// refresh, where stale children must be reconciled even when the provider
// returns none this run (e.g. a show that dropped a season).
const CHILD_ENTITY_SCHEMA_SLUGS: Readonly<Record<string, string>> = {
	show: "show-season",
	podcast: "podcast-episode",
	"show-season": "show-episode",
};

const REDIS_RETRY_SCHEDULE = Schedule.spaced("30 seconds");

type SynchronizeOptions = {
	entitySchemaSlug?: string;
	mode: "initial" | "refresh";
	childEntitySchemaSlugs?: Readonly<Record<string, string>>;
};

const ValidatedEntityDetails = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	childEntities: Schema.Array(ProviderDetailsChildEntitySchema),
	relatedEntityGroups: Schema.Array(ProviderDetailsRelatedEntityGroupSchema),
});

type ValidatedEntityDetails = typeof ValidatedEntityDetails.Type;

type ChildEntitySetScope = {
	parentName: string;
	parentEntityId: EntityId;
	parentExternalId: string;
	parentProperties: unknown;
	parentEntitySchemaId: EntitySchemaId;
	parentEntitySchemaSlug?: string | undefined;
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

const checkExistingEntity = Effect.fn("checkExistingEntity")(function* (
	payload: EntityImportPayload,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* EntitiesRepository;

	return yield* Activity.make({
		name: "check-existing-entity",
		success: Schema.NullOr(ListedEntity),
		execute: runWithDb(
			repository.findGlobalEntityByExternalId({
				externalId: payload.externalId,
				sandboxScriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
			}),
		).pipe(dieOnDbError),
	});
});

const validateEntityDetails = Effect.fn("validateEntityDetails")(function* (value: unknown) {
	return yield* Activity.make({
		error: SandboxRunError,
		success: ValidatedEntityDetails,
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
		error: SandboxRunError,
		name: "upsert-root-entity",
		success: ProviderEntitySaveEnvelope,
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
					sandboxScriptId: payload.scriptId,
					entitySchemaId: payload.entitySchemaId,
					updateExisting: options.mode !== "refresh",
				});
				return { result, committedAt: (yield* DateTime.nowAsDate).toISOString() };
			}),
		).pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		),
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
		error: SandboxRunError,
		success: RelationshipSyncEnvelope,
		name: `sync-related-entity-group:${index}:${group.relationshipSchemaSlug}`,
		execute: runInTransaction(
			Effect.gen(function* () {
				const outcomes = yield* syncRelatedEntityGroup({
					group,
					primaryEntityId: entity.id,
					primaryEntitySchemaId: payload.entitySchemaId,
				});
				return { outcomes, committedAt: (yield* DateTime.nowAsDate).toISOString() };
			}),
		).pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		),
	});
});

const writeChildEntitySetScope = Effect.fn("writeChildEntitySetScope")(function* (
	payload: EntityImportPayload,
	options: SynchronizeOptions,
	scope: ChildEntitySetScope,
) {
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		error: SandboxRunError,
		success: ChildEntitySetWriteResult,
		name: `write-child-entity-set:${scope.parentExternalId}`,
		execute: runInTransaction(
			writeChildEntitySet({
				sandboxScriptId: payload.scriptId,
				childEntities: scope.childEntities,
				parentEntityId: scope.parentEntityId,
				syncExisting: options.mode === "refresh",
				parentEntitySchemaId: scope.parentEntitySchemaId,
				parentEntitySchemaSlug: scope.parentEntitySchemaSlug,
				childEntitySchemaSlugs: options.childEntitySchemaSlugs,
			}),
		).pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		),
	});
});

const stampRootPopulatedAt = Effect.fn("stampProviderRootPopulatedAt")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
) {
	const entities = yield* EntitiesService;
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		error: SandboxRunError,
		name: "stamp-root-populated-at",
		success: ProviderEntitySaveEnvelope,
		execute: runInTransaction(
			Effect.gen(function* () {
				const populatedAt = yield* DateTime.nowAsDate;
				const result = yield* entities.upsert({
					populatedAt,
					name: details.name,
					updateExisting: true,
					properties: details.properties,
					externalId: payload.externalId,
					sandboxScriptId: payload.scriptId,
					entitySchemaId: payload.entitySchemaId,
				});
				return { result, committedAt: (yield* DateTime.nowAsDate).toISOString() };
			}),
		).pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		),
	});
});

const publishPrimaryEntity = Effect.fn("publishProviderPrimaryEntity")(function* (
	entity: ListedEntity,
) {
	const redis = yield* RedisService;

	yield* Activity.make({
		error: SandboxRunError,
		name: "publish-primary-entity",
		execute: redis
			.publish(redisKeys.entityUpdatedChannel, encodeEntityUpdatedMessage(entity.id, "populated"))
			.pipe(
				Effect.asVoid,
				Effect.sandbox,
				Effect.retry({
					schedule: REDIS_RETRY_SCHEDULE,
					while: (cause) => !Cause.isInterrupted(cause),
				}),
				Effect.unsandbox,
			),
	});
});

const shouldWriteChildEntitySet = (options: SynchronizeOptions, scope: ChildEntitySetScope) =>
	scope.childEntities.length > 0 ||
	(!!scope.parentEntitySchemaSlug &&
		!!options.childEntitySchemaSlugs?.[scope.parentEntitySchemaSlug]);

const toLifecycleSnapshot = (snapshot: ProviderEntitySaveResult["outcome"]["after"]) => ({
	...snapshot,
	properties: asRecord(snapshot.properties) ?? {},
});

const toLifecycleRelationshipSnapshot = (snapshot: RelationshipMutationSnapshot) => ({
	id: snapshot.id,
	source: snapshot.sourceEntity,
	target: snapshot.targetEntity,
	relationshipSchemaId: snapshot.relationshipSchemaId,
	properties: asRecord(snapshot.properties) ?? {},
	relationshipSchemaSlug: snapshot.relationshipSchemaSlug,
});

const deterministicId = (prefix: string, parts: ReadonlyArray<string>) =>
	`${prefix}_${new Bun.CryptoHasher("sha256").update(stableStringify(parts)).digest("base64url")}`;

const relationshipSnapshot = (outcome: RelationshipMutationOutcome) =>
	outcome.after ?? outcome.before;

const relationshipMutationIdentity = (outcome: RelationshipMutationOutcome) => {
	const snapshot = relationshipSnapshot(outcome);
	return stableStringify([
		snapshot.relationshipSchemaId,
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
		first.relationshipSchemaId,
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
			snapshot.relationshipSchemaId,
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

const owningSeasonForScope = (scope: ChildEntitySetScope) => {
	if (scope.parentEntitySchemaSlug !== "show-season") {
		return undefined;
	}
	const seasonNumber = asRecord(scope.parentProperties)?.["seasonNumber"];
	return {
		name: scope.parentName,
		number: typeof seasonNumber === "number" && Number.isFinite(seasonNumber) ? seasonNumber : null,
	};
};

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
		const owningSeason = owningSeasonForScope(scope);
		yield* dispatchRelationshipSync({
			executionId,
			direction: "outgoing",
			origin: payload.origin,
			committedAt: processed.committedAt,
			anchorEntityId: scope.parentEntityId,
			outcomes: processed.relationshipOutcomes,
			population: {
				rootPreviouslyPopulated,
				scopeEntity: scope.scopeEntity,
				...(owningSeason ? { owningSeason } : {}),
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
					rootPreviouslyPopulated,
					scopeEntity: scope.scopeEntity,
					...(owningSeason ? { owningSeason } : {}),
				},
			});
			pending.push({
				parentName: child.entity.name,
				scopeEntity: scope.scopeEntity,
				parentEntityId: child.entity.id,
				parentExternalId: childEntity.externalId,
				parentProperties: child.entity.properties,
				parentEntitySchemaId: child.entitySchemaId,
				childEntities: childEntity.childEntities ?? [],
				parentEntitySchemaSlug: childEntity.entitySchemaSlug,
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
		entitySchemaId: entity.entitySchemaId,
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
		parentEntitySchemaId: payload.entitySchemaId,
		parentEntitySchemaSlug: options.entitySchemaSlug,
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

// `Workflow.make` requires a struct payload, so the ensure/refresh discriminator
// lives on `mode` with `entitySchemaSlug` optional at the schema level. Ensure callers
// omit it; refresh requires it (the handler dies otherwise, see below) so stale children
// are reconciled even when the provider returns none this run.
export const ProviderEntityPopulationPayload = Schema.Struct({
	...EntityImportPayload.fields,
	mode: Schema.Literal("ensure", "refresh"),
	entitySchemaSlug: Schema.optional(Schema.String),
});

export type ProviderEntityPopulationPayload = typeof ProviderEntityPopulationPayload.Type;

export const ProviderEntityPopulationWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	name: "ProviderEntityPopulationWorkflow",
	payload: ProviderEntityPopulationPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

// Exported for unit testing only. Production callers must dispatch
// `ProviderEntityPopulationWorkflow` via the workflow engine; the
// workflow-boundaries test enforces that this handler is never imported
// by production modules.
export const runProviderEntityPopulationWorkflow = Effect.fn("ProviderEntityPopulationWorkflow")(
	function* (payload: ProviderEntityPopulationPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			scriptId: payload.scriptId,
			externalId: payload.externalId,
			entitySchemaId: payload.entitySchemaId,
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
				{ mode: "initial" },
				rootPreviouslyPopulated,
			);
		}

		// Refresh reconciles stale children via `entitySchemaSlug`. Without it, a provider
		// returning no children would silently retain removed ones, so a refresh missing the
		// slug is a malformed payload rather than a recoverable failure.
		if (!payload.entitySchemaSlug) {
			return yield* Effect.die(
				"ProviderEntityPopulationWorkflow: entitySchemaSlug is required for refresh",
			);
		}

		return yield* synchronizeEntityGraph(
			payload,
			executionId,
			{
				mode: "refresh",
				entitySchemaSlug: payload.entitySchemaSlug,
				childEntitySchemaSlugs: CHILD_ENTITY_SCHEMA_SLUGS,
			},
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
