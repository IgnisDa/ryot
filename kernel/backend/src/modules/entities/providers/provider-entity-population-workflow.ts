import { mapDbErrorToSandbox, SandboxRunError } from "@ryot-app/contract/errors";
import { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	encodeEntityUpdatedMessage,
	type EntityUpdatedReason,
} from "@ryot-app/contract/modules/entity-watches/messages";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	type EntitySchemaSlug,
	PluginId,
	PluginRevisionId,
	RelationshipSchemaSlug,
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
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Cause, DateTime, Effect, Result, Schedule, Schema } from "effect";
import { DurableClock, Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { DurableSchema } from "#boot/workflow-engine";
import { populationLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntityRelationshipDefinitions } from "#modules/definitions/snapshot";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { TranslationsService } from "#modules/entities/localization/service";
import { EntitySnapshotResult } from "#modules/entities/mutation-outcomes";
import { populationRequestPin } from "#modules/entities/population-trigger";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { type DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { RelationshipsRepository } from "#modules/relationships/repository";
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
import {
	type EntityImportPayload,
	entityImportPayloadFields,
	EntityImportScope,
	PopulationLevel,
} from "./schemas";

const REDIS_RETRY_SCHEDULE = Schedule.spaced("30 seconds");
export const RELATED_PAGES_MAX_PAGES = 200;

type SynchronizeOptions = {
	level: PopulationLevel;
	mode: "initial" | "refresh";
	entitySchemaSlug: EntitySchemaSlug;
};

const ValidatedEntityDetails = Schema.Struct({
	name: Schema.String,
	checkedAt: Schema.String,
	properties: jsonValueSchema,
	expectedChildEntitySchemaSlug: Schema.optional(Schema.String),
	childEntities: Schema.Array(providerDetailsChildEntitySchema),
	relatedEntityGroups: Schema.Array(providerDetailsRelatedEntityGroupSchema),
});

type ValidatedEntityDetails = typeof ValidatedEntityDetails.Type;

type PopulationWritePayload = EntityImportPayload & {
	readonly requestId: string;
	readonly requestAttempt: number;
};

const populationWriteGuard = (payload: PopulationWritePayload) =>
	Effect.flatMap(EnrichmentRequests, (requests) =>
		requests.guardPopulation(payload.requestId, payload.requestAttempt),
	);

const PopulationTarget = Schema.Struct({ entity: ListedEntity, relatedPopulated: Schema.Boolean });

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
	parentEntitySchemaPluginId: AutomationPopulationContext["scopeEntity"]["entitySchemaPluginId"];
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
			return yield* new SandboxRunError({
				kind: "invalid-input",
				message: "Provider population requires persisted plugin authority",
			});
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
		success: Schema.NullOr(PopulationTarget) satisfies DurableSchema,
		execute: repository
			.findPopulationTarget({
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
				checkedAt: (yield* DateTime.nowAsDate).toISOString(),
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
	phase: "root-stamp" | "root-upsert",
) =>
	dispatchPopulationPlans(
		dispatch,
		"provider entity population completed with automation warnings",
		{ phase },
	);

const upsertRootEntity = Effect.fn("upsertProviderRootEntity")(function* (
	payload: PopulationWritePayload,
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
					Effect.andThen(
						populationWriteGuard(payload),
						entities.persistPlannedProviderUpsert({
							...scope,
							populatedAt: null,
							name: details.name,
							preservePopulatedAt: true,
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
				),
			).pipe(mapDbErrorToSandbox);
			return { dispatch: work.dispatch, result: { entity: work.result.entity } };
		}),
	});
});

const syncRelatedEntityGroupScope = Effect.fn("syncProviderRelatedEntityGroupScope")(function* (
	payload: PopulationWritePayload,
	definitions: EntityRelationshipDefinitions,
	entityId: EntityId,
	group: Omit<ProviderDetailsRelatedEntityGroup, "continuation">,
	index: number,
	population: AutomationPopulationContext,
	paging: { pageIndex: number; generation: string },
) {
	const entityScope = getEntityWriteScope(payload);
	const synchronized = yield* makeActivity({
		error: SandboxRunError satisfies DurableSchema,
		success: RelationshipSyncEnvelope satisfies DurableSchema,
		name: `sync-related-entity-group:${index}:${group.relationshipSchemaSlug}:page:${paging.pageIndex}`,
		execute: syncRelatedEntityGroup({
			beforeWrite: (yield* EnrichmentRequests).guardPopulation(
				payload.requestId,
				payload.requestAttempt,
			),
			...entityScope,
			group,
			population,
			definitions,
			command: payload.command,
			primaryEntityId: entityId,
			pluginId: payload.pluginId,
			paging: { ...paging, groupIndex: index },
			primaryEntitySchemaSlug: payload.entitySchemaSlug,
		}).pipe(mapDbErrorToSandbox),
	});
	if (!synchronized.superseded) {
		yield* publishPrimaryEntity(
			entityId,
			"enrichment-updated",
			`publish-related-group:${index}:${paging.pageIndex}`,
		);
	}
	yield* dispatchPopulationPlans(
		synchronized.dispatch,
		"provider related population completed with automation warnings",
		{ relationshipSchemaSlug: group.relationshipSchemaSlug },
	);
	return synchronized;
});

const writeChildEntitySetScope = Effect.fn("writeChildEntitySetScope")(function* (
	payload: PopulationWritePayload,
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
			beforeWrite: (yield* EnrichmentRequests).guardPopulation(
				payload.requestId,
				payload.requestAttempt,
			),
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
	payload: PopulationWritePayload,
	details: ValidatedEntityDetails,
	population: AutomationPopulationContext,
	options: SynchronizeOptions,
	generation: string,
) {
	const session = yield* DatabaseSession;
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const scope = getEntityWriteScope(payload);

	return yield* makeActivity({
		name: "stamp-root-populated-at",
		error: SandboxRunError satisfies DurableSchema,
		success: ProviderEntitySaveEnvelope satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const populatedAt = DateTime.toDateUtc(DateTime.makeUnsafe(payload.command.occurredAt));
			const work = yield* retryOnDeadlock(
				session.transaction(
					Effect.gen(function* () {
						yield* populationWriteGuard(payload);
						const stamped = yield* entities.persistPlannedProviderUpsert({
							...scope,
							populatedAt,
							name: details.name,
							updateExisting: true,
							properties: details.properties,
							externalId: payload.externalId,
							providerId: payload.providerId,
							preservePopulatedAt: options.mode === "initial",
							entitySchema: {
								slug: payload.entitySchemaSlug,
								owner: definitionOwner(payload.pluginId),
							},
							lifecycle: {
								...payload.command,
								...populationLifecycleCommand(payload.command, ["root", "stamp"], population),
							},
						});
						if (options.level === "full") {
							yield* repository.invalidateRelatedPopulated(
								stamped.result.entity.id,
								populatedAt,
								generation,
							);
						}
						yield* (yield* EnrichmentRequests).recordBaseCheck(
							payload.requestId,
							DateTime.toDateUtc(DateTime.makeUnsafe(details.checkedAt)),
						);
						return stamped;
					}),
				),
			).pipe(mapDbErrorToSandbox);
			return { dispatch: work.dispatch, result: { entity: work.result.entity } };
		}),
	});
});

const publishPrimaryEntity = Effect.fn("publishProviderPrimaryEntity")(function* (
	entityId: EntityId,
	reason: Extract<EntityUpdatedReason, "populated" | "enrichment-updated"> = "populated",
	activityName = "publish-primary-entity",
) {
	const redis = yield* RedisService;

	yield* makeActivity({
		name: activityName,
		error: SandboxRunError satisfies DurableSchema,
		execute: redis
			.publish(redisKeys.entityUpdatedChannel, encodeEntityUpdatedMessage(entityId, reason))
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
	payload: PopulationWritePayload,
	definitions: EntityRelationshipDefinitions,
	options: SynchronizeOptions,
	rootPreviouslyPopulated: boolean,
	rootScope: ChildEntitySetScope,
) {
	const pending: ChildEntitySetScope[] = [rootScope];
	let scope: undefined | ChildEntitySetScope;
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
	requestId: Schema.String,
	requestAttempt: Schema.Int,
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
	error: SandboxRunError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: ProviderRelatedPagesPayload satisfies DurableSchema,
	success: Schema.Literals(["complete", "superseded"]) satisfies DurableSchema,
});

const claimRelatedGroupGenerationScope = Effect.fn("claimRelatedGroupGenerationScope")(function* (
	payload: PopulationWritePayload,
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
			beforeWrite: (yield* EnrichmentRequests).guardPopulation(
				payload.requestId,
				payload.requestAttempt,
			),
		}).pipe(mapDbErrorToSandbox),
	});
});

const logSupersededRelatedGroup = (
	entityId: EntityId,
	group: Pick<ProviderDetailsRelatedEntityGroup, "direction" | "relationshipSchemaSlug">,
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
	payload: PopulationWritePayload,
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
		return "complete" as const;
	}
	return yield* dispatchAdmittedWorkflow(
		receipts,
		engine,
		ProviderRelatedPagesWorkflow,
		payload.command.accountGeneration,
		{
			executionId,
			payload: {
				population,
				groupIndex,
				generation,
				executionId,
				entityId: entity.id,
				command: payload.command,
				pluginId: payload.pluginId,
				requestId: payload.requestId,
				providerId: payload.providerId,
				externalId: payload.externalId,
				entityScope: payload.entityScope,
				continuation: group.continuation,
				requestAttempt: payload.requestAttempt,
				entitySchemaSlug: payload.entitySchemaSlug,
				group: {
					direction: group.direction,
					synchronization: group.synchronization,
					relationshipSchemaSlug: group.relationshipSchemaSlug,
				},
			},
		},
		(admission) => admission,
		(execution) => execution,
	).pipe(
		Effect.mapError((error) =>
			error instanceof SandboxRunError
				? error
				: new SandboxRunError({ kind: "infrastructure", message: error.message }),
		),
	);
});

const supersededPopulation = () =>
	new SandboxRunError({ kind: "invalid-input", message: "Provider population was superseded" });

const stampRelatedPopulatedAt = Effect.fn("stampProviderRelatedPopulatedAt")(function* (
	payload: PopulationWritePayload,
	definitions: EntityRelationshipDefinitions,
	entityId: EntityId,
	groups: ReadonlyArray<ProviderDetailsRelatedEntityGroup>,
	generation: string,
) {
	const session = yield* DatabaseSession;
	const checks = yield* DomainWriteChecks;
	const repository = yield* EntitiesRepository;
	const relationships = yield* RelationshipsRepository;
	const scope = getEntityWriteScope(payload);
	yield* makeActivity({
		name: "stamp-related-populated-at",
		error: SandboxRunError satisfies DurableSchema,
		execute: retryOnDeadlock(
			session.transaction(
				Effect.gen(function* () {
					yield* populationWriteGuard(payload);
					yield* checks.check(
						payload.command,
						definitionOwner(payload.pluginId),
						scope.scope === "user" ? scope.userId : null,
						true,
					);
					const ordered = sortBy(groups, (group) =>
						stableStringify([group.relationshipSchemaSlug, group.direction]),
					);
					for (const group of ordered) {
						const definition =
							definitions.relationshipSchemas[
								definitionKey(
									"relationship",
									definitionOwner(payload.pluginId),
									group.relationshipSchemaSlug,
								)
							];
						if (
							!definition ||
							!(yield* relationships.holdsRelationshipSyncGeneration(
								{
									anchorEntityId: entityId,
									direction: group.direction,
									relationshipSchemaPluginId: definition.pluginId ?? null,
									relationshipSchemaSlug: RelationshipSchemaSlug.make(definition.slug),
								},
								generation,
							))
						) {
							return yield* supersededPopulation();
						}
					}
					yield* repository.lockMutationKeys([entityId]);
					if (!(yield* repository.holdsRelatedPopulationGeneration(entityId, generation))) {
						return yield* supersededPopulation();
					}
					return yield* repository.stampRelatedPopulated(
						entityId,
						DateTime.toDateUtc(DateTime.makeUnsafe(payload.command.occurredAt)),
					);
				}),
			),
		).pipe(mapDbErrorToSandbox),
	});
});

const synchronizeEntityGraph = Effect.fn("synchronizeEntityGraph")(function* (
	payload: PopulationWritePayload,
	definitions: EntityRelationshipDefinitions,
	executionId: string,
	options: SynchronizeOptions,
	existing: null | ListedEntity,
	requestId: string,
) {
	const operations = yield* EntityImportWorkflowOperations;
	const sandboxResult = yield* operations.processSandbox(payload, executionId, options.level);
	if (sandboxResult.error) {
		return yield* new SandboxRunError({
			kind: sandboxResult.error.kind,
			message: sandboxResult.error.message,
			...(sandboxResult.error.data === undefined ? {} : { data: sandboxResult.error.data }),
		});
	}

	const details = yield* validateEntityDetails(sandboxResult.value);
	const relatedEntityGroups = options.level === "full" ? details.relatedEntityGroups : [];
	if (relatedEntityGroups.some(({ continuation }) => continuation !== undefined)) {
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
	const entity = rootSave.result.entity;
	const requests = yield* EnrichmentRequests;
	yield* makeActivity({
		name: "attach-population-entity",
		error: SandboxRunError satisfies DurableSchema,
		execute: requests.attachEntity(requestId, entity.id),
	});
	yield* logEntityWarnings(rootSave.dispatch, "root-upsert");
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
	const stamped = yield* stampRootPopulatedAt(payload, details, population, options, executionId);
	yield* logEntityWarnings(stamped.dispatch, "root-stamp");
	yield* publishPrimaryEntity(stamped.result.entity.id);
	if (options.level === "base") {
		return stamped.result.entity;
	}
	const outcomes = yield* Effect.forEach(relatedEntityGroups, (group, index) =>
		Effect.gen(function* () {
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
				return "superseded" as const;
			}
			if (group.continuation === undefined) {
				return group.synchronization === "authoritative"
					? yield* sweepRelatedGroupScope(
							{
								...payload,
								group,
								population,
								groupIndex: index,
								continuation: null,
								entityId: entity.id,
								generation: executionId,
							},
							definitions,
						)
					: ("complete" as const);
			}
			return yield* startRelatedPagesWorkflow(
				payload,
				stamped.result.entity,
				group,
				index,
				population,
				executionId,
			);
		}).pipe(Effect.result),
	);
	if (outcomes.some((outcome) => Result.isSuccess(outcome) && outcome.success === "superseded")) {
		return yield* supersededPopulation();
	}
	for (const outcome of outcomes) {
		if (Result.isFailure(outcome)) {
			return yield* outcome.failure;
		}
	}
	yield* stampRelatedPopulatedAt(payload, definitions, entity.id, relatedEntityGroups, executionId);
	yield* publishPrimaryEntity(entity.id, "enrichment-updated", "publish-related-populated");
	return stamped.result.entity;
});

export const ProviderEntityPopulationPayload = Schema.Struct({
	manualRefresh: Schema.optional(Schema.Boolean),
	translationLanguage: Schema.optional(Schema.String),
	...entityImportPayloadFields,
	level: PopulationLevel,
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

export const ProviderEntityPopulationAttemptWorkflow = Workflow.make(
	"ProviderEntityPopulationAttemptWorkflow",
	{
		success: ListedEntity satisfies DurableSchema,
		error: SandboxRunError satisfies DurableSchema,
		idempotencyKey: ({ executionId }) => executionId,
		payload: Schema.Struct({
			...ProviderEntityPopulationPayload.fields,
			requestId: Schema.String,
			requestAttempt: Schema.Int,
		}) satisfies DurableSchema,
	},
);

export type ProviderEntityPopulationAttemptPayload =
	typeof ProviderEntityPopulationAttemptWorkflow.payloadSchema.Type;

export const runProviderEntityPopulationAttemptWorkflow = Effect.fn(
	"ProviderEntityPopulationAttemptWorkflow",
)(
	function* (payload: ProviderEntityPopulationAttemptPayload, executionId: string) {
		const requestId = payload.requestId;
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
			ProviderEntityPopulationAttemptWorkflow,
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
		const target = yield* checkExistingEntity(payload, entityScope, definitions);
		const existing = target?.entity ?? null;
		if (existing !== null) {
			const requests = yield* EnrichmentRequests;
			yield* makeActivity({
				name: "attach-existing-population-entity",
				error: SandboxRunError satisfies DurableSchema,
				execute: requests.attachEntity(requestId, existing.id),
			});
		}
		if (payload.mode === "ensure") {
			if (
				target !== null &&
				target.entity.populatedAt !== null &&
				(payload.level === "base" || target.relatedPopulated)
			) {
				return target.entity;
			}
			return yield* synchronizeEntityGraph(
				payload,
				definitions,
				executionId,
				{ mode: "initial", level: payload.level, entitySchemaSlug: payload.entitySchemaSlug },
				existing,
				requestId,
			);
		}

		return yield* synchronizeEntityGraph(
			payload,
			definitions,
			executionId,
			{ mode: "refresh", level: payload.level, entitySchemaSlug: payload.entitySchemaSlug },
			existing,
			requestId,
		);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, {
			executionId,
			workflow: "ProviderEntityPopulationAttemptWorkflow",
		}),
);

export const ProviderEntityPopulationAttemptWorkflowDefinitionsLive = implementWorkflow(
	ProviderEntityPopulationAttemptWorkflow,
	runProviderEntityPopulationAttemptWorkflow,
);

export const runProviderEntityPopulationWorkflow = Effect.fn("ProviderEntityPopulationWorkflow")(
	function* (input: ProviderEntityPopulationPayload, executionId: string) {
		const requests = yield* EnrichmentRequests;
		const receipts = yield* MutationReceipts.make;
		const engine = yield* WorkflowEngine;
		yield* admitWorkflow(
			receipts,
			ProviderEntityPopulationWorkflow,
			input.command.accountGeneration,
			executionId,
		).pipe(
			Effect.mapError(
				(error) => new SandboxRunError({ kind: "infrastructure", message: error.message }),
			),
		);
		const retainedRequest = yield* makeActivity({
			name: "ensure-population-request",
			error: SandboxRunError satisfies DurableSchema,
			success: Schema.Struct({
				joinedTo: Schema.NullOr(Schema.String),
				payload: ProviderEntityPopulationPayload,
			}) satisfies DurableSchema,
			execute: requests
				.ensure({
					payload: input,
					entityId: null,
					language: null,
					id: executionId,
					level: input.level,
					operation: "population",
					pluginId: input.pluginId,
					populationMode: input.mode,
					providerId: input.providerId,
					externalId: input.externalId,
					cooldown: input.manualRefresh,
					entitySchemaSlug: input.entitySchemaSlug,
					requester: input.command.accountGeneration,
					populationPin: populationRequestPin(input.command),
					workflowName: ProviderEntityPopulationWorkflow._tag,
					scopeUserId: input.entityScope.type === "user" ? input.entityScope.userId : null,
				})
				.pipe(
					Effect.flatMap((row) =>
						Schema.decodeUnknownEffect(ProviderEntityPopulationPayload)(row.payload).pipe(
							Effect.map((payload) => ({ payload, joinedTo: row.joinedTo })),
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										kind: "invalid-input",
										message: `Invalid persisted population request: ${error.message}`,
									}),
							),
						),
					),
				),
		});
		const { payload, joinedTo } = retainedRequest;
		const refreshTranslation = Effect.fnUntraced(function* (entity: ListedEntity) {
			const accountGeneration = payload.command.accountGeneration;
			if (payload.translationLanguage && accountGeneration !== null) {
				const translations = yield* TranslationsService;
				yield* makeActivity({
					name: "refresh-current-translation",
					error: SandboxRunError satisfies DurableSchema,
					execute: translations
						.requestFill({
							accountGeneration,
							entityId: entity.id,
							providerId: payload.providerId,
							externalId: payload.externalId,
							userId: accountGeneration.userId,
							lane: payload.command.causation.lane,
							language: payload.translationLanguage,
							entitySchemaPluginId: payload.pluginId,
							entitySchemaSlug: payload.entitySchemaSlug,
							refreshKey: stableStringify([joinedTo ?? executionId, accountGeneration]),
						})
						.pipe(Effect.asVoid),
				});
			}
		});
		if (joinedTo !== null) {
			for (let observation = 0; ; observation += 1) {
				const result = yield* makeActivity({
					name: `joined-population:${observation}`,
					error: SandboxRunError satisfies DurableSchema,
					success: Schema.NullOr(ListedEntity) satisfies DurableSchema,
					execute: Effect.gen(function* () {
						const owner = yield* requests.get(joinedTo).pipe(mapDbErrorToSandbox);
						if (!owner || owner.state === "failed" || owner.state === "cancelled") {
							yield* requests.update(executionId, {
								state: "failed",
								failureKind: owner?.failureKind ?? "infrastructure",
							});
							return yield* new SandboxRunError({
								kind: owner?.failureKind ?? "infrastructure",
								message: "Shared provider population failed",
							});
						}
						if (owner.state !== "succeeded" || owner.entityId === null) {
							return null;
						}
						const entity = yield* (yield* EntitiesRepository)
							.getById(EntityId.make(owner.entityId))
							.pipe(mapDbErrorToSandbox);
						if (!entity) {
							return yield* new SandboxRunError({
								kind: "invalid-input",
								message: "Refreshed provider entity is unavailable",
							});
						}
						yield* requests.attachEntity(executionId, entity.id);
						yield* requests.update(executionId, { failureKind: null, state: "succeeded" });
						return entity;
					}),
				});
				if (result !== null) {
					yield* refreshTranslation(result);
					return result;
				}
				yield* DurableClock.sleep({
					duration: 1000,
					inMemoryThreshold: 0,
					name: `joined-population-wait:${observation}`,
				});
			}
		}
		for (let observation = 0; ; observation += 1) {
			const claimed = yield* makeActivity({
				error: SandboxRunError,
				success: Schema.Boolean,
				name: `claim-population:${observation}`,
				execute: requests.claimPopulation(executionId),
			});
			if (claimed) {
				break;
			}
			yield* DurableClock.sleep({
				duration: 1000,
				inMemoryThreshold: 0,
				name: `population-queue-wait:${observation}`,
			});
		}
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const startedAt = yield* makeActivity({
				success: Schema.String,
				name: `population-started:${attempt}`,
				execute: Effect.map(DateTime.nowAsDate, (now) => now.toISOString()),
			});
			yield* makeActivity({
				name: `population-running:${attempt}`,
				error: SandboxRunError satisfies DurableSchema,
				execute: requests
					.update(executionId, {
						attempt,
						state: "running",
						failureKind: null,
						nextAttemptAt: null,
					})
					.pipe(Effect.asVoid),
			});
			const attemptId = `${executionId}-attempt-${attempt}`;
			const result = yield* dispatchAdmittedWorkflow(
				receipts,
				engine,
				ProviderEntityPopulationAttemptWorkflow,
				payload.command.accountGeneration,
				{
					executionId: attemptId,
					payload: {
						...payload,
						executionId: attemptId,
						requestId: executionId,
						requestAttempt: attempt,
						command: {
							...payload.command,
							occurredAt: startedAt,
							causation: {
								...payload.command.causation,
								executionId: AutomationExecutionId.make(attemptId),
							},
						},
					},
				},
				(admission) =>
					admission.pipe(
						Effect.mapError(
							(error) => new SandboxRunError({ kind: "infrastructure", message: error.message }),
						),
					),
				(execution) => execution,
			).pipe(Effect.result);
			if (Result.isSuccess(result)) {
				yield* makeActivity({
					name: "population-succeeded",
					error: SandboxRunError satisfies DurableSchema,
					execute: requests
						.attachEntity(executionId, result.success.id)
						.pipe(
							Effect.andThen(
								requests.update(executionId, {
									attempt,
									failureKind: null,
									state: "succeeded",
									nextAttemptAt: null,
								}),
							),
							Effect.asVoid,
						),
				});
				yield* refreshTranslation(result.success);
				return result.success;
			}
			const failure = result.failure;
			if (
				attempt === 3 ||
				failure.data !== undefined ||
				(failure.kind !== "infrastructure" && failure.kind !== "timeout")
			) {
				yield* Effect.logWarning("Provider population failed", {
					attempt,
					kind: failure.kind,
					requestId: executionId,
					message: failure.message,
				});
				yield* makeActivity({
					name: "population-failed",
					error: SandboxRunError satisfies DurableSchema,
					execute: requests
						.update(executionId, {
							attempt,
							state: "failed",
							nextAttemptAt: null,
							failureKind: failure.kind,
						})
						.pipe(Effect.asVoid),
				});
				return yield* failure;
			}
			const delayMs = attempt === 1 ? 5_000 : 30_000;
			yield* makeActivity({
				name: `population-retrying:${attempt}`,
				error: SandboxRunError satisfies DurableSchema,
				execute: Effect.gen(function* () {
					const now = yield* DateTime.now;
					yield* requests.update(executionId, {
						attempt,
						state: "retrying",
						failureKind: failure.kind,
						nextAttemptAt: DateTime.toDateUtc(DateTime.add(now, { milliseconds: delayMs })),
					});
				}),
			});
			yield* DurableClock.sleep({
				duration: delayMs,
				inMemoryThreshold: 0,
				name: `population-retry:${attempt}`,
			});
		}
		return yield* Effect.die("Provider population exhausted its bounded attempts");
	},
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
			beforeWrite: (yield* EnrichmentRequests).guardPopulation(
				payload.requestId,
				payload.requestAttempt,
			),
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
	if (!swept.superseded) {
		yield* publishPrimaryEntity(
			payload.entityId,
			"enrichment-updated",
			`publish-related-sweep:${payload.groupIndex}`,
		);
	}
	yield* dispatchPopulationPlans(
		swept.dispatch,
		"provider related sweep completed with automation warnings",
		{ relationshipSchemaSlug: payload.group.relationshipSchemaSlug },
	);
	if (swept.superseded) {
		yield* logSupersededRelatedGroup(payload.entityId, payload.group, payload.groupIndex, -1);
	}
	return swept.superseded ? ("superseded" as const) : ("complete" as const);
});

type RelatedPageOutcome = "next" | "complete" | "superseded";

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
			...(sandboxResult.error.data === undefined ? {} : { data: sandboxResult.error.data }),
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
			);
			outcome = step.outcome;
			if (step.outcome !== "next") {
				break;
			}
			continuation = step.continuation;
		}
		if (outcome === "next") {
			return yield* new SandboxRunError({
				kind: "invalid-output",
				message: "Related entity pages reached the page limit",
			});
		}
		if (outcome === "complete" && payload.group.synchronization === "authoritative") {
			return yield* sweepRelatedGroupScope(payload, definitions);
		}
		return outcome;
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProviderRelatedPagesWorkflow" }),
);

export const ProviderRelatedPagesWorkflowDefinitionsLive = implementWorkflow(
	ProviderRelatedPagesWorkflow,
	runProviderRelatedPagesWorkflow,
);
