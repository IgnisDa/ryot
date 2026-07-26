import { SandboxRunError, mapDbErrorToSandbox } from "@ryot-app/contract/errors";
import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-interest/messages";
import { EntityId, type EntitySchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
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
import { Cause, DateTime, Effect, Schedule, Schema } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";

import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { Database, mapDatabaseErrors, retryOnDeadlock } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { DefinitionRegistry, DefinitionSnapshot } from "#modules/definition-registry/service";
import { EntityMutationOutcome } from "#modules/entities/mutation-outcomes";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

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
	scopeEntity: AutomationPopulationContext["scopeEntity"];
	childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
};

const ProviderEntitySaveEnvelope = Schema.Struct({
	result: Schema.Struct({
		entity: ListedEntity,
		wasInserted: Schema.Boolean,
		outcome: EntityMutationOutcome,
	}),
});

const RelationshipSyncEnvelope = Schema.Struct({
	created: Schema.Finite,
	updated: Schema.Finite,
	deleted: Schema.Finite,
	upserted: Schema.Finite,
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
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: "Entity schema not found",
		});
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
					(error) =>
						new SandboxRunError({
							kind: "invalid-output",
							message: `Invalid entity details: ${error.message}`,
						}),
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

const commandFor = (
	command: LifecycleCommand,
	itemIdentity: ReadonlyArray<string>,
	population: AutomationPopulationContext,
): LifecycleCommand => ({
	...command,
	population,
	itemIdentity: stableStringify([command.itemIdentity, ...itemIdentity]),
});

const providerEntityIdFor = (command: LifecycleCommand, itemIdentity: ReadonlyArray<string>) =>
	EntityId.make(
		`ent_${sha256Base64Url(
			stableStringify([
				command.causation.executionId,
				stableStringify([command.itemIdentity, ...itemIdentity]),
			]),
		)}`,
	);

const logEntityWarnings = (warnings: ReadonlyArray<unknown>, phase: "root-upsert" | "root-stamp") =>
	warnings.length === 0
		? Effect.void
		: Effect.logWarning("provider entity population completed with automation warnings").pipe(
				Effect.annotateLogs({ phase, warnings, warningCount: warnings.length }),
			);

const upsertRootEntity = Effect.fn("upsertProviderRootEntity")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	options: SynchronizeOptions,
	population: AutomationPopulationContext,
) {
	const database = yield* Database;
	const entities = yield* EntitiesService;
	const scope = getEntityWriteScope(payload);

	return yield* Activity.make({
		name: "upsert-root-entity",
		error: SandboxRunError satisfies DurableSchema,
		success: ProviderEntitySaveEnvelope satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const work = yield* retryOnDeadlock(
				mapDatabaseErrors(
					database.transaction((transaction) =>
						entities
							.persistPlannedProviderUpsert({
								...scope,
								populatedAt: null,
								name: details.name,
								externalId: payload.externalId,
								properties: details.properties,
								providerId: payload.providerId,
								entitySchemaSlug: payload.entitySchemaSlug,
								updateExisting: options.mode !== "refresh",
								lifecycle: commandFor(payload.command, ["root", "upsert"], population),
							})
							.pipe(Effect.provideService(Database, transaction)),
					),
				),
			).pipe(mapDbErrorToSandbox);
			const warnings = yield* entities.executeCommittedPlans(work.plans).pipe(mapDbErrorToSandbox);
			yield* logEntityWarnings(warnings, "root-upsert");
			return { result: work.result };
		}),
	});
});

const syncRelatedEntityGroupScope = Effect.fn("syncProviderRelatedEntityGroupScope")(function* (
	payload: EntityImportPayload,
	definitions: DefinitionSnapshot,
	entity: ListedEntity,
	group: ProviderDetailsRelatedEntityGroup,
	index: number,
	population: AutomationPopulationContext,
) {
	const entityScope = getEntityWriteScope(payload);
	return yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		success: Schema.Array(RelationshipSyncEnvelope) satisfies DurableSchema,
		name: `sync-related-entity-group:${index}:${group.relationshipSchemaSlug}`,
		execute: syncRelatedEntityGroup({
			...entityScope,
			group,
			population,
			definitions,
			command: payload.command,
			primaryEntityId: entity.id,
			primaryEntitySchemaSlug: payload.entitySchemaSlug,
		}).pipe(mapDbErrorToSandbox),
	});
});

const writeChildEntitySetScope = Effect.fn("writeChildEntitySetScope")(function* (
	payload: EntityImportPayload,
	definitions: DefinitionSnapshot,
	options: SynchronizeOptions,
	scope: ChildEntitySetScope,
	rootPreviouslyPopulated: boolean,
) {
	const entityScope = getEntityWriteScope(payload);
	return yield* Activity.make({
		error: SandboxRunError satisfies DurableSchema,
		name: `write-child-entity-set:${scope.parentExternalId}`,
		success: ChildEntitySetWriteResult satisfies DurableSchema,
		execute: writeChildEntitySet({
			...entityScope,
			definitions,
			command: payload.command,
			providerId: payload.providerId,
			childEntities: scope.childEntities,
			parentEntityId: scope.parentEntityId,
			syncExisting: options.mode === "refresh",
			parentEntitySchemaSlug: scope.parentEntitySchemaSlug,
			expectedChildEntitySchemaSlug: scope.expectedChildEntitySchemaSlug,
			population: {
				rootPreviouslyPopulated,
				scopeEntity: scope.scopeEntity,
				parentEntity: {
					name: scope.parentName,
					entitySchemaSlug: scope.parentEntitySchemaSlug,
					properties: toSandboxJsonObject(scope.parentProperties),
				},
			},
		}).pipe(mapDbErrorToSandbox),
	});
});

const stampRootPopulatedAt = Effect.fn("stampProviderRootPopulatedAt")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	population: AutomationPopulationContext,
) {
	const database = yield* Database;
	const entities = yield* EntitiesService;
	const scope = getEntityWriteScope(payload);

	return yield* Activity.make({
		name: "stamp-root-populated-at",
		error: SandboxRunError satisfies DurableSchema,
		success: ProviderEntitySaveEnvelope satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const populatedAt = DateTime.toDateUtc(DateTime.makeUnsafe(payload.command.occurredAt));
			const work = yield* retryOnDeadlock(
				mapDatabaseErrors(
					database.transaction((transaction) =>
						entities
							.persistPlannedProviderUpsert({
								...scope,
								populatedAt,
								name: details.name,
								updateExisting: true,
								properties: details.properties,
								externalId: payload.externalId,
								providerId: payload.providerId,
								entitySchemaSlug: payload.entitySchemaSlug,
								lifecycle: commandFor(payload.command, ["root", "stamp"], population),
							})
							.pipe(Effect.provideService(Database, transaction)),
					),
				),
			).pipe(mapDbErrorToSandbox);
			const warnings = yield* entities.executeCommittedPlans(work.plans).pipe(mapDbErrorToSandbox);
			yield* logEntityWarnings(warnings, "root-stamp");
			return { result: work.result };
		}),
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

const writeChildEntityScopes = Effect.fn("writeChildEntityScopes")(function* (
	payload: EntityImportPayload,
	definitions: DefinitionSnapshot,
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
		const processed = yield* writeChildEntitySetScope(
			payload,
			definitions,
			options,
			scope,
			rootPreviouslyPopulated,
		);
		for (const [index, childEntity] of scope.childEntities.entries()) {
			const child = processed.processedChildren[index];
			if (!child) {
				continue;
			}
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
	existing: ListedEntity | null,
) {
	const operations = yield* EntityImportWorkflowOperations;
	const sandboxResult = yield* operations.processSandbox(payload, executionId);
	if (sandboxResult.error) {
		return yield* new SandboxRunError({
			kind: sandboxResult.error.kind,
			message: sandboxResult.error.message,
		});
	}

	const details = yield* validateEntityDetails(sandboxResult.value);
	const rootPreviouslyPopulated = existing !== null && existing.populatedAt !== null;
	const scopeEntity = {
		name: details.name,
		entitySchemaSlug: options.entitySchemaSlug,
		id: existing?.id ?? providerEntityIdFor(payload.command, ["root", "upsert"]),
	};
	const population = { scopeEntity, rootPreviouslyPopulated } satisfies AutomationPopulationContext;
	const rootSave = yield* upsertRootEntity(payload, details, options, population);
	const entity = rootSave.result.entity;
	for (const [index, group] of details.relatedEntityGroups.entries()) {
		yield* syncRelatedEntityGroupScope(payload, definitions, entity, group, index, population);
	}
	yield* writeChildEntityScopes(payload, definitions, options, rootPreviouslyPopulated, {
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
	const stamped = yield* stampRootPopulatedAt(payload, details, population);
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
		if (payload.mode === "ensure") {
			if (existing && existing.populatedAt !== null) {
				return existing;
			}
			return yield* synchronizeEntityGraph(
				payload,
				definitions,
				executionId,
				{ mode: "initial", entitySchemaSlug: payload.entitySchemaSlug },
				existing,
			);
		}

		return yield* synchronizeEntityGraph(
			payload,
			definitions,
			executionId,
			{ mode: "refresh", entitySchemaSlug: payload.entitySchemaSlug },
			existing,
		);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProviderEntityPopulationWorkflow" }),
);

const ProviderEntityPopulationWorkflowLive = ProviderEntityPopulationWorkflow.toLayer(
	runProviderEntityPopulationWorkflow,
);

export const ProviderEntityPopulationWorkflowDefinitionsLive = ProviderEntityPopulationWorkflowLive;
