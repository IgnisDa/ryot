import { mapDbErrorToSandbox, SandboxRunError } from "@ryot-app/contract/errors";
import { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	type EntitySchemaSlug,
	PluginId,
	PluginRevisionId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import {
	type ProviderDetailsChildEntity,
	providerDetailsChildEntitySchema,
	type ProviderDetailsRelatedEntityGroup,
	providerDetailsRelatedEntityGroupSchema,
	providerDetailsResultSchema,
	providerRelatedResultSchema,
} from "@ryot-app/plugin-backend-sdk/provider";
import { type JsonValue, jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Cause, DateTime, Effect, Schedule, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { DurableSchema } from "#boot/workflow-engine";
import { populationLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntityRelationshipDefinitions } from "#modules/definitions/snapshot";
import { EntitySnapshotResult } from "#modules/entities/mutation-outcomes";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { type DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { retryOnDeadlock } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import { redisKeys, RedisService } from "#platform/redis";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { ChildEntitySetWriteResult, writeChildEntitySet } from "./population";
import {
	claimRelatedGroupGeneration,
	sweepRelatedEntityGroup,
	syncRelatedEntityGroup,
} from "./relationship-population";
import { type EntityImportPayload, entityImportPayloadFields, EntityImportScope } from "./schemas";

const REDIS_RETRY_SCHEDULE = Schedule.spaced("30 seconds");
export const RELATED_PAGES_MAX_PAGES = 200;

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
	parentEntitySchemaPluginId: AutomationPopulationContext["scopeEntity"]["entitySchemaPluginId"];
	scopeEntity: AutomationPopulationContext["scopeEntity"];
	childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
};

const ProviderEntitySaveEnvelope = Schema.Struct({
	result: EntitySnapshotResult,
	dispatch: Schema.Array(LifecycleDispatchPlan),
});

const RelationshipSyncEnvelope = Schema.Struct({
	superseded: Schema.Boolean,
	dispatch: Schema.Array(LifecycleDispatchPlan),
	result: Schema.Array(
		Schema.Struct({
			created: Schema.Finite,
			updated: Schema.Finite,
			deleted: Schema.Finite,
			upserted: Schema.Finite,
		}),
	),
});

const resolveProviderEntityDefinitions = (
	entityScope: { scope: "global" } | { scope: "user"; userId: UserId },
	payload: EntityImportPayload,
) =>
	makeActivity({
		name: "resolve-provider-entity-definitions",
		error: SandboxRunError satisfies DurableSchema,
		success: EntityRelationshipDefinitions satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const definitions = yield* DefinitionRepository;
			const checks = yield* DomainWriteChecks;
			const pin = yield* checks
				.check(
					payload.command,
					definitionOwner(payload.pluginId),
					entityScope.scope === "user" ? entityScope.userId : null,
				)
				.pipe(
					Effect.mapError(
						(error) => new SandboxRunError({ kind: "script-failure", message: error.message }),
					),
				);
			if (pin) {
				const owner = definitionOwner(payload.pluginId);
				const rows = yield* definitions
					.readPinnedRows({
						pluginId: PluginId.make(payload.pluginId),
						pluginRevisionId: PluginRevisionId.make(pin.id),
					})
					.pipe(mapDbErrorToSandbox);
				return {
					entitySchemas: Object.fromEntries(
						rows.entitySchemas.map(({ slug }) => [
							definitionKey("entity", owner, slug),
							{ slug, pluginId: payload.pluginId },
						]),
					),
					relationshipSchemas: Object.fromEntries(
						rows.relationshipSchemas.map((definition) => [
							definitionKey("relationship", owner, definition.slug),
							{
								name: definition.name,
								slug: definition.slug,
								pluginId: payload.pluginId,
								propertiesSchema: definition.propertiesSchema,
								sourceEntitySchemaSlug: definition.sourceEntitySchemaSlug,
								targetEntitySchemaSlug: definition.targetEntitySchemaSlug,
							},
						]),
					),
				};
			}
			return yield* (
				entityScope.scope === "user"
					? definitions.getUserEntityRelationshipDefinitions(entityScope.userId)
					: definitions.getGlobalEntityRelationshipDefinitions
			).pipe(mapDbErrorToSandbox);
		}),
	});

const checkExistingEntity = Effect.fn("checkExistingEntity")(function* (
	payload: EntityImportPayload,
	entityScope: { scope: "global" } | { scope: "user"; userId: UserId },
	definitions: EntityRelationshipDefinitions,
) {
	const repository = yield* EntitiesRepository;
	const schema =
		definitions.entitySchemas[
			definitionKey("entity", definitionOwner(payload.pluginId), payload.entitySchemaSlug)
		];
	if (!schema) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: "Entity schema not found",
		});
	}

	return yield* makeActivity({
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
	return yield* makeActivity({
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

const providerEntityIdFor = (
	command: DomainLifecycleCommand,
	itemIdentity: ReadonlyArray<string>,
) =>
	EntityId.make(
		`ent_${sha256Base64Url(
			stableStringify([
				command.causation.executionId,
				stableStringify([command.itemIdentity, ...itemIdentity]),
			]),
		)}`,
	);

const dispatchPopulationPlans = (
	dispatch: ReadonlyArray<LifecycleDispatchPlan>,
	message: string,
	annotations: Readonly<Record<string, unknown>>,
) =>
	Effect.gen(function* () {
		const execution = yield* LifecycleExecution;
		const warnings = yield* execution.dispatch(dispatch).pipe(mapDbErrorToSandbox);
		if (warnings.length > 0) {
			yield* Effect.logWarning(message).pipe(
				Effect.annotateLogs({ ...annotations, warnings, warningCount: warnings.length }),
			);
		}
	});

const logEntityWarnings = (
	dispatch: ReadonlyArray<LifecycleDispatchPlan>,
	phase: "root-upsert" | "root-stamp",
) =>
	dispatchPopulationPlans(
		dispatch,
		"provider entity population completed with automation warnings",
		{ phase },
	);

const upsertRootEntity = Effect.fn("upsertProviderRootEntity")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	options: SynchronizeOptions,
	population: AutomationPopulationContext,
) {
	const session = yield* DatabaseSession;
	const entities = yield* EntitiesService;
	const scope = getEntityWriteScope(payload);

	return yield* makeActivity({
		name: "upsert-root-entity",
		error: SandboxRunError satisfies DurableSchema,
		success: ProviderEntitySaveEnvelope satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const work = yield* retryOnDeadlock(
				session.transaction(
					entities.persistPlannedProviderUpsert({
						...scope,
						populatedAt: null,
						name: details.name,
						externalId: payload.externalId,
						properties: details.properties,
						providerId: payload.providerId,
						updateExisting: options.mode !== "refresh",
						entitySchema: {
							slug: payload.entitySchemaSlug,
							owner: definitionOwner(payload.pluginId),
						},
						lifecycle: {
							...payload.command,
							...populationLifecycleCommand(payload.command, ["root", "upsert"], population),
						},
					}),
				),
			).pipe(mapDbErrorToSandbox);
			return { dispatch: work.dispatch, result: { entity: work.result.entity } };
		}),
	});
});

const syncRelatedEntityGroupScope = Effect.fn("syncProviderRelatedEntityGroupScope")(function* (
	payload: EntityImportPayload,
	definitions: EntityRelationshipDefinitions,
	entityId: EntityId,
	group: Omit<ProviderDetailsRelatedEntityGroup, "continuation">,
	index: number,
	population: AutomationPopulationContext,
	paging?: { generation: string; pageIndex: number },
) {
	const entityScope = getEntityWriteScope(payload);
	const synchronized = yield* makeActivity({
		error: SandboxRunError satisfies DurableSchema,
		success: RelationshipSyncEnvelope satisfies DurableSchema,
		name: `sync-related-entity-group:${index}:${group.relationshipSchemaSlug}${
			paging ? `:page:${paging.pageIndex}` : ""
		}`,
		execute: syncRelatedEntityGroup({
			...entityScope,
			group,
			population,
			definitions,
			command: payload.command,
			primaryEntityId: entityId,
			pluginId: payload.pluginId,
			primaryEntitySchemaSlug: payload.entitySchemaSlug,
			...(paging ? { paging: { ...paging, groupIndex: index } } : {}),
		}).pipe(mapDbErrorToSandbox),
	});
	yield* dispatchPopulationPlans(
		synchronized.dispatch,
		"provider related population completed with automation warnings",
		{ relationshipSchemaSlug: group.relationshipSchemaSlug },
	);
	return synchronized;
});

const writeChildEntitySetScope = Effect.fn("writeChildEntitySetScope")(function* (
	payload: EntityImportPayload,
	definitions: EntityRelationshipDefinitions,
	options: SynchronizeOptions,
	scope: ChildEntitySetScope,
	rootPreviouslyPopulated: boolean,
) {
	const entityScope = getEntityWriteScope(payload);
	const written = yield* makeActivity({
		error: SandboxRunError satisfies DurableSchema,
		name: `write-child-entity-set:${scope.parentExternalId}`,
		success: ChildEntitySetWriteResult satisfies DurableSchema,
		execute: writeChildEntitySet({
			...entityScope,
			definitions,
			command: payload.command,
			pluginId: payload.pluginId,
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
					entitySchemaPluginId: scope.parentEntitySchemaPluginId,
					properties: toSandboxJsonObject(scope.parentProperties),
				},
			},
		}).pipe(mapDbErrorToSandbox),
	});
	yield* dispatchPopulationPlans(
		written.dispatch,
		"provider child population completed with automation warnings",
		{ parentEntityId: scope.parentEntityId },
	);
	return written;
});

const stampRootPopulatedAt = Effect.fn("stampProviderRootPopulatedAt")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	population: AutomationPopulationContext,
) {
	const session = yield* DatabaseSession;
	const entities = yield* EntitiesService;
	const scope = getEntityWriteScope(payload);

	return yield* makeActivity({
		name: "stamp-root-populated-at",
		error: SandboxRunError satisfies DurableSchema,
		success: ProviderEntitySaveEnvelope satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const populatedAt = DateTime.toDateUtc(DateTime.makeUnsafe(payload.command.occurredAt));
			const work = yield* retryOnDeadlock(
				session.transaction(
					entities.persistPlannedProviderUpsert({
						...scope,
						populatedAt,
						name: details.name,
						updateExisting: true,
						properties: details.properties,
						externalId: payload.externalId,
						providerId: payload.providerId,
						entitySchema: {
							slug: payload.entitySchemaSlug,
							owner: definitionOwner(payload.pluginId),
						},
						lifecycle: {
							...payload.command,
							...populationLifecycleCommand(payload.command, ["root", "stamp"], population),
						},
					}),
				),
			).pipe(mapDbErrorToSandbox);
			return { dispatch: work.dispatch, result: { entity: work.result.entity } };
		}),
	});
});

const publishPrimaryEntity = Effect.fn("publishProviderPrimaryEntity")(function* (
	entityId: EntityId,
) {
	const redis = yield* RedisService;

	yield* makeActivity({
		name: "publish-primary-entity",
		error: SandboxRunError satisfies DurableSchema,
		execute: redis
			.publish(redisKeys.entityUpdatedChannel, encodeEntityUpdatedMessage(entityId, "populated"))
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
	definitions: EntityRelationshipDefinitions,
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
				parentEntitySchemaPluginId: child.entity.entitySchemaPluginId,
				...(childEntity.expectedChildEntitySchemaSlug
					? { expectedChildEntitySchemaSlug: childEntity.expectedChildEntitySchemaSlug }
					: {}),
			});
		}
	}
});

export const ProviderRelatedPagesPayload = Schema.Struct({
	...entityImportPayloadFields,
	entityId: EntityId,
	generation: Schema.String,
	groupIndex: Schema.Finite,
	continuation: jsonValueSchema,
	entityScope: EntityImportScope,
	population: AutomationPopulationContext,
	group: Schema.Struct({
		relationshipSchemaSlug: Schema.String,
		direction: Schema.Literals(["incoming", "outgoing"]),
		synchronization: Schema.Literals(["authoritative", "additive"]),
	}),
});

export type ProviderRelatedPagesPayload = typeof ProviderRelatedPagesPayload.Type;

export const ProviderRelatedPagesWorkflow = Workflow.make("ProviderRelatedPagesWorkflow", {
	success: Schema.Void satisfies DurableSchema,
	error: SandboxRunError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: ProviderRelatedPagesPayload satisfies DurableSchema,
});

const claimRelatedGroupGenerationScope = Effect.fn("claimRelatedGroupGenerationScope")(function* (
	payload: EntityImportPayload,
	definitions: EntityRelationshipDefinitions,
	entityId: EntityId,
	group: ProviderDetailsRelatedEntityGroup,
	index: number,
	generation: string,
) {
	yield* makeActivity({
		error: SandboxRunError satisfies DurableSchema,
		name: `claim-related-group-generation:${index}:${group.relationshipSchemaSlug}`,
		execute: claimRelatedGroupGeneration({
			group,
			generation,
			definitions,
			primaryEntityId: entityId,
			pluginId: payload.pluginId,
			startedAt: DateTime.toDateUtc(DateTime.makeUnsafe(payload.command.occurredAt)),
		}).pipe(mapDbErrorToSandbox),
	});
});

const logSupersededRelatedGroup = (
	entityId: EntityId,
	group: Pick<ProviderDetailsRelatedEntityGroup, "relationshipSchemaSlug" | "direction">,
	groupIndex: number,
	pageIndex: number,
) =>
	Effect.logWarning("related entity group sync superseded by a newer population").pipe(
		Effect.annotateLogs({
			entityId,
			pageIndex,
			groupIndex,
			direction: group.direction,
			relationshipSchemaSlug: group.relationshipSchemaSlug,
		}),
	);

const startRelatedPagesWorkflow = Effect.fn("startRelatedPagesWorkflow")(function* (
	payload: EntityImportPayload,
	entity: ListedEntity,
	group: ProviderDetailsRelatedEntityGroup,
	groupIndex: number,
	population: AutomationPopulationContext,
	generation: string,
) {
	const engine = yield* WorkflowEngine;
	const receipts = yield* MutationReceipts.make;
	const executionId = `related-${entity.id}-${groupIndex}-${generation}`;
	if (group.continuation === undefined) {
		return;
	}
	yield* dispatchAdmittedWorkflow(
		receipts,
		engine,
		ProviderRelatedPagesWorkflow,
		payload.command.accountGeneration,
		{
			executionId,
			discard: true,
			payload: {
				population,
				groupIndex,
				generation,
				executionId,
				entityId: entity.id,
				command: payload.command,
				pluginId: payload.pluginId,
				providerId: payload.providerId,
				externalId: payload.externalId,
				entityScope: payload.entityScope,
				continuation: group.continuation,
				entitySchemaSlug: payload.entitySchemaSlug,
				group: {
					direction: group.direction,
					synchronization: group.synchronization,
					relationshipSchemaSlug: group.relationshipSchemaSlug,
				},
			},
		},
		(admission) => admission,
		(execution) => execution.pipe(Effect.asVoid),
	).pipe(Effect.catch((error) => Effect.logWarning("related pages enqueue failed", error)));
});

const synchronizeEntityGraph = Effect.fn("synchronizeEntityGraph")(function* (
	payload: EntityImportPayload,
	definitions: EntityRelationshipDefinitions,
	executionId: string,
	options: SynchronizeOptions,
	existing: ListedEntity | null,
) {
	const operations = yield* EntityImportWorkflowOperations;
	const sandboxResult = yield* operations.processSandbox(
		payload,
		executionId,
		existing?.properties,
	);
	if (sandboxResult.error) {
		return yield* new SandboxRunError({
			kind: sandboxResult.error.kind,
			message: sandboxResult.error.message,
		});
	}

	const details = yield* validateEntityDetails(sandboxResult.value);
	if (details.relatedEntityGroups.some(({ continuation }) => continuation !== undefined)) {
		yield* operations.requireRelatedScript(payload);
	}
	const rootPreviouslyPopulated = existing !== null && existing.populatedAt !== null;
	const scopeEntity = {
		name: details.name,
		entitySchemaPluginId: payload.pluginId,
		entitySchemaSlug: options.entitySchemaSlug,
		id: existing?.id ?? providerEntityIdFor(payload.command, ["root", "upsert"]),
	};
	const population = { scopeEntity, rootPreviouslyPopulated } satisfies AutomationPopulationContext;
	const rootSave = yield* upsertRootEntity(payload, details, options, population);
	yield* logEntityWarnings(rootSave.dispatch, "root-upsert");
	const entity = rootSave.result.entity;
	const continued: Array<{ index: number; group: ProviderDetailsRelatedEntityGroup }> = [];
	for (const [index, group] of details.relatedEntityGroups.entries()) {
		if (group.continuation === undefined) {
			yield* syncRelatedEntityGroupScope(payload, definitions, entity.id, group, index, population);
			continue;
		}
		yield* claimRelatedGroupGenerationScope(
			payload,
			definitions,
			entity.id,
			group,
			index,
			executionId,
		);
		const firstPage = yield* syncRelatedEntityGroupScope(
			payload,
			definitions,
			entity.id,
			group,
			index,
			population,
			{ pageIndex: 0, generation: executionId },
		);
		if (firstPage.superseded) {
			yield* logSupersededRelatedGroup(entity.id, group, index, 0);
			continue;
		}
		continued.push({ index, group });
	}
	yield* writeChildEntityScopes(payload, definitions, options, rootPreviouslyPopulated, {
		scopeEntity,
		parentName: entity.name,
		parentEntityId: entity.id,
		parentProperties: entity.properties,
		parentExternalId: payload.externalId,
		childEntities: details.childEntities,
		parentEntitySchemaSlug: options.entitySchemaSlug,
		parentEntitySchemaPluginId: entity.entitySchemaPluginId,
		...(details.expectedChildEntitySchemaSlug
			? { expectedChildEntitySchemaSlug: details.expectedChildEntitySchemaSlug }
			: {}),
	});
	const stamped = yield* stampRootPopulatedAt(payload, details, population);
	yield* logEntityWarnings(stamped.dispatch, "root-stamp");
	yield* publishPrimaryEntity(stamped.result.entity.id);
	for (const { index, group } of continued) {
		yield* startRelatedPagesWorkflow(
			payload,
			stamped.result.entity,
			group,
			index,
			population,
			executionId,
		);
	}
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
		const receipts = yield* MutationReceipts.make;
		if (payload.command.writeContext?.pluginRevision?.id !== payload.pluginId) {
			return yield* new SandboxRunError({
				kind: "invalid-input",
				message: "Provider population requires its exact persisted plugin authority",
			});
		}
		const checks = yield* DomainWriteChecks;
		const provider = yield* checks
			.checkProvider(payload.providerId, definitionOwner(payload.pluginId))
			.pipe(
				Effect.mapError(
					(error) => new SandboxRunError({ kind: "invalid-input", message: error.message }),
				),
			);
		if (provider.rootEntitySchemaSlug !== payload.entitySchemaSlug) {
			return yield* new SandboxRunError({
				kind: "invalid-input",
				message: "Provider root schema does not match its exact owner",
			});
		}
		yield* admitWorkflow(
			receipts,
			ProviderEntityPopulationWorkflow,
			payload.command.accountGeneration,
			executionId,
		).pipe(
			Effect.mapError(
				(error) => new SandboxRunError({ kind: "infrastructure", message: error.message }),
			),
		);
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
		const definitions = yield* resolveProviderEntityDefinitions(entityScope, payload);
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

export const ProviderEntityPopulationWorkflowDefinitionsLive = implementWorkflow(
	ProviderEntityPopulationWorkflow,
	runProviderEntityPopulationWorkflow,
);

const validateRelatedPage = (value: unknown, groupIndex: number, pageIndex: number) =>
	makeActivity({
		error: SandboxRunError satisfies DurableSchema,
		name: `validate-related-page:${groupIndex}:${pageIndex}`,
		success: providerRelatedResultSchema satisfies DurableSchema,
		execute: Schema.decodeUnknownEffect(providerRelatedResultSchema)(value).pipe(
			Effect.mapError(
				(error) =>
					new SandboxRunError({
						kind: "invalid-output",
						message: `Invalid related entities: ${error.message}`,
					}),
			),
		),
	});

const sweepRelatedGroupScope = Effect.fn("sweepRelatedGroupScope")(function* (
	payload: ProviderRelatedPagesPayload,
	definitions: EntityRelationshipDefinitions,
) {
	const swept = yield* makeActivity({
		error: SandboxRunError satisfies DurableSchema,
		success: RelationshipSyncEnvelope satisfies DurableSchema,
		name: `sweep-related-entity-group:${payload.groupIndex}:${payload.group.relationshipSchemaSlug}`,
		execute: sweepRelatedEntityGroup({
			...getEntityWriteScope(payload),
			definitions,
			group: payload.group,
			command: payload.command,
			pluginId: payload.pluginId,
			population: payload.population,
			generation: payload.generation,
			groupIndex: payload.groupIndex,
			primaryEntityId: payload.entityId,
		}).pipe(mapDbErrorToSandbox),
	});
	yield* dispatchPopulationPlans(
		swept.dispatch,
		"provider related sweep completed with automation warnings",
		{ relationshipSchemaSlug: payload.group.relationshipSchemaSlug },
	);
	if (swept.superseded) {
		yield* logSupersededRelatedGroup(payload.entityId, payload.group, payload.groupIndex, -1);
	}
});

type RelatedPageOutcome = "next" | "complete" | "superseded" | "failed";

const processRelatedPage = Effect.fn("processRelatedPage")(function* (
	payload: ProviderRelatedPagesPayload,
	definitions: EntityRelationshipDefinitions,
	executionId: string,
	pageIndex: number,
	continuation: JsonValue,
) {
	const operations = yield* EntityImportWorkflowOperations;
	const sandboxResult = yield* operations.processRelatedPage(
		payload,
		`${executionId}-sandbox-related-${payload.groupIndex}-${pageIndex}`,
		continuation,
	);
	if (sandboxResult.error) {
		return yield* new SandboxRunError({
			kind: sandboxResult.error.kind,
			message: sandboxResult.error.message,
		});
	}
	const page = yield* validateRelatedPage(sandboxResult.value, payload.groupIndex, pageIndex);
	const synchronized = yield* syncRelatedEntityGroupScope(
		payload,
		definitions,
		payload.entityId,
		{ ...payload.group, entities: page.entities },
		payload.groupIndex,
		payload.population,
		{ pageIndex, generation: payload.generation },
	);
	if (synchronized.superseded) {
		yield* logSupersededRelatedGroup(
			payload.entityId,
			payload.group,
			payload.groupIndex,
			pageIndex,
		);
		return { continuation: null, outcome: "superseded" } as const;
	}
	return page.continuation === null
		? ({ continuation: null, outcome: "complete" } as const)
		: ({ outcome: "next", continuation: page.continuation } as const);
});

// Exported for unit testing only. Production callers must dispatch
// `ProviderRelatedPagesWorkflow` via the workflow engine.
export const runProviderRelatedPagesWorkflow = Effect.fn("ProviderRelatedPagesWorkflow")(
	function* (payload: ProviderRelatedPagesPayload, executionId: string) {
		const receipts = yield* MutationReceipts.make;
		if (payload.command.writeContext?.pluginRevision?.id !== payload.pluginId) {
			return yield* new SandboxRunError({
				kind: "invalid-input",
				message: "Provider related pages require their exact persisted plugin authority",
			});
		}
		const checks = yield* DomainWriteChecks;
		const provider = yield* checks
			.checkProvider(payload.providerId, definitionOwner(payload.pluginId))
			.pipe(
				Effect.mapError(
					(error) => new SandboxRunError({ kind: "invalid-input", message: error.message }),
				),
			);
		if (provider.rootEntitySchemaSlug !== payload.entitySchemaSlug) {
			return yield* new SandboxRunError({
				kind: "invalid-input",
				message: "Provider root schema does not match its exact owner",
			});
		}
		yield* admitWorkflow(
			receipts,
			ProviderRelatedPagesWorkflow,
			payload.command.accountGeneration,
			executionId,
		).pipe(
			Effect.mapError(
				(error) => new SandboxRunError({ kind: "infrastructure", message: error.message }),
			),
		);
		const definitions = yield* resolveProviderEntityDefinitions(
			getEntityWriteScope(payload),
			payload,
		);
		let outcome: RelatedPageOutcome = "next";
		let continuation: JsonValue = payload.continuation;
		for (let pageIndex = 1; pageIndex < RELATED_PAGES_MAX_PAGES; pageIndex += 1) {
			const step = yield* processRelatedPage(
				payload,
				definitions,
				executionId,
				pageIndex,
				continuation,
			).pipe(
				Effect.catch((error) =>
					Effect.logWarning("related entity page failed; skipping the sweep").pipe(
						Effect.annotateLogs({
							pageIndex,
							message: error.message,
							entityId: payload.entityId,
							groupIndex: payload.groupIndex,
							relationshipSchemaSlug: payload.group.relationshipSchemaSlug,
						}),
						Effect.as({ outcome: "failed", continuation: null } as const),
					),
				),
			);
			outcome = step.outcome;
			if (step.outcome !== "next") {
				break;
			}
			continuation = step.continuation;
		}
		if (outcome === "next") {
			yield* Effect.logWarning(
				"related entity pages reached the page limit; skipping the sweep",
			).pipe(
				Effect.annotateLogs({
					entityId: payload.entityId,
					groupIndex: payload.groupIndex,
					relationshipSchemaSlug: payload.group.relationshipSchemaSlug,
				}),
			);
		}
		if (outcome === "complete" && payload.group.synchronization === "authoritative") {
			yield* sweepRelatedGroupScope(payload, definitions);
		}
		return yield* publishPrimaryEntity(payload.entityId);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProviderRelatedPagesWorkflow" }),
);

export const ProviderRelatedPagesWorkflowDefinitionsLive = implementWorkflow(
	ProviderRelatedPagesWorkflow,
	runProviderRelatedPagesWorkflow,
);
