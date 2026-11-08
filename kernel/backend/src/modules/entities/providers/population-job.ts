import { mapDbErrorToSandbox, SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { EntityUpdatedReason } from "@ryot-app/contract/modules/live-updates/messages";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	type EntitySchemaSlug,
	PluginId,
	PluginRevisionId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import {
	type ProviderDetailsChildEntity,
	type ProviderDetailsRelatedEntityGroup,
	providerDetailsResultSchema,
	providerRelatedResultSchema,
} from "@ryot-app/plugin-backend-sdk/provider";
import { type JsonValue, jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Duration, Effect, Result, Schema } from "effect";

import { populationLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import type { LifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import type { EntityRelationshipDefinitions } from "#modules/definitions/snapshot";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { TranslationsService } from "#modules/entities/localization/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { type DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
import { publishEntityUpdated } from "#modules/live-updates/publish";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { retryOnDeadlock } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import { makeJobKind } from "#platform/jobs/queue";
import { type JobContext, registerJobHandler } from "#platform/jobs/worker";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { writeChildEntitySet } from "./population";
import { sweepRelatedEntityGroup, syncRelatedEntityGroup } from "./relationship-population";
import {
	type EntityImportPayload,
	entityImportPayloadFields,
	EntityImportScope,
	PopulationLevel,
} from "./schemas";

export const RELATED_PAGES_MAX_PAGES = 200;

export type PopulationWritePayload = ProviderEntityPopulationPayload & {
	readonly requestId: string;
	readonly requestAttempt: number;
};

type SynchronizeOptions = {
	level: PopulationLevel;
	mode: "initial" | "refresh";
	entitySchemaSlug: EntitySchemaSlug;
};

type ValidatedEntityDetails = {
	readonly name: string;
	readonly checkedAt: string;
	readonly properties: JsonValue;
	readonly expectedChildEntitySchemaSlug?: string;
	readonly childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
	readonly relatedEntityGroups: ReadonlyArray<ProviderDetailsRelatedEntityGroup>;
};

const populationWriteGuard = (payload: PopulationWritePayload) =>
	Effect.flatMap(EnrichmentRequests, (requests) =>
		requests.guardPopulation(payload.requestId, payload.requestAttempt),
	);

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

const resolveProviderEntityDefinitions = Effect.fn("resolveProviderEntityDefinitions")(function* (
	entityScope: { scope: "global" } | { scope: "user"; userId: UserId },
	payload: EntityImportPayload,
) {
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
	if (!pin) {
		return yield* new SandboxRunError({
			kind: "invalid-input",
			message: "Provider population requires persisted plugin authority",
		});
	}
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
	} satisfies EntityRelationshipDefinitions;
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
	return yield* repository
		.findPopulationTarget({
			...entityScope,
			externalId: payload.externalId,
			providerId: payload.providerId,
			entitySchemaSlug: payload.entitySchemaSlug,
			entitySchemaPluginId: schema.pluginId ?? null,
		})
		.pipe(mapDbErrorToSandbox);
});

const validateEntityDetails = Effect.fn("validateEntityDetails")(function* (value: unknown) {
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

const publishPrimaryEntity = Effect.fn("publishProviderPrimaryEntity")(function* (
	payload: PopulationWritePayload,
	entityId: EntityId,
	reason: Extract<EntityUpdatedReason, "populated" | "enrichment-updated"> = "populated",
) {
	const requests = yield* EnrichmentRequests;
	yield* publishEntityUpdated(
		entityId,
		reason,
		yield* requests.requesterIds(payload.requestId),
	).pipe(mapDbErrorToSandbox);
});

const upsertRootEntity = Effect.fn("upsertProviderRootEntity")(function* (
	payload: PopulationWritePayload,
	details: ValidatedEntityDetails,
	options: SynchronizeOptions,
	population: AutomationPopulationContext,
) {
	const session = yield* DatabaseSession;
	const entities = yield* EntitiesService;
	const scope = getEntityWriteScope(payload);
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
});

const syncRelatedEntityGroupScope = Effect.fn("syncProviderRelatedEntityGroupScope")(function* (
	payload: PopulationWritePayload,
	definitions: EntityRelationshipDefinitions,
	entityId: EntityId,
	group: Omit<ProviderDetailsRelatedEntityGroup, "coverage">,
	index: number,
	population: AutomationPopulationContext,
	paging: { pageIndex: number; generation: string },
) {
	const requests = yield* EnrichmentRequests;
	const synchronized = yield* syncRelatedEntityGroup({
		beforeWrite: requests.guardPopulation(payload.requestId, payload.requestAttempt),
		...getEntityWriteScope(payload),
		group,
		population,
		definitions,
		command: payload.command,
		primaryEntityId: entityId,
		pluginId: payload.pluginId,
		paging: { ...paging, groupIndex: index },
		primaryEntitySchemaSlug: payload.entitySchemaSlug,
	}).pipe(mapDbErrorToSandbox);
	if (!synchronized.superseded) {
		yield* publishPrimaryEntity(payload, entityId, "enrichment-updated");
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
	const requests = yield* EnrichmentRequests;
	const written = yield* writeChildEntitySet({
		beforeWrite: requests.guardPopulation(payload.requestId, payload.requestAttempt),
		...getEntityWriteScope(payload),
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
	}).pipe(mapDbErrorToSandbox);
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
	const requests = yield* EnrichmentRequests;
	const scope = getEntityWriteScope(payload);
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
				yield* requests.recordBaseCheck(
					payload.requestId,
					DateTime.toDateUtc(DateTime.makeUnsafe(details.checkedAt)),
				);
				return stamped;
			}),
		),
	).pipe(mapDbErrorToSandbox);
	return { dispatch: work.dispatch, result: { entity: work.result.entity } };
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

const supersededPopulation = () =>
	new SandboxRunError({ kind: "invalid-input", message: "Provider population was superseded" });

const stampRelatedPopulatedAt = Effect.fn("stampProviderRelatedPopulatedAt")(function* (
	payload: PopulationWritePayload,
	entityId: EntityId,
	generation: string,
) {
	const session = yield* DatabaseSession;
	const checks = yield* DomainWriteChecks;
	const repository = yield* EntitiesRepository;
	const scope = getEntityWriteScope(payload);
	yield* retryOnDeadlock(
		session.transaction(
			Effect.gen(function* () {
				yield* populationWriteGuard(payload);
				yield* checks.check(
					payload.command,
					definitionOwner(payload.pluginId),
					scope.scope === "user" ? scope.userId : null,
					true,
				);
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
	).pipe(mapDbErrorToSandbox);
});

type RelatedGroupRun = {
	readonly index: number;
	readonly entityId: EntityId;
	readonly generation: string;
	readonly population: AutomationPopulationContext;
	readonly group: Pick<
		ProviderDetailsRelatedEntityGroup,
		"direction" | "synchronization" | "relationshipSchemaSlug"
	>;
};

const sweepRelatedGroup = Effect.fn("sweepRelatedGroup")(function* (
	payload: PopulationWritePayload,
	definitions: EntityRelationshipDefinitions,
	run: RelatedGroupRun,
	kept: ReadonlySet<EntityId>,
) {
	const requests = yield* EnrichmentRequests;
	const swept = yield* sweepRelatedEntityGroup({
		beforeWrite: requests.guardPopulation(payload.requestId, payload.requestAttempt),
		...getEntityWriteScope(payload),
		kept,
		definitions,
		group: run.group,
		groupIndex: run.index,
		command: payload.command,
		pluginId: payload.pluginId,
		population: run.population,
		generation: run.generation,
		primaryEntityId: run.entityId,
	}).pipe(mapDbErrorToSandbox);
	if (swept.superseded) {
		yield* logSupersededRelatedGroup(run.entityId, run.group, run.index, -1);
		return "superseded" as const;
	}
	yield* publishPrimaryEntity(payload, run.entityId, "enrichment-updated");
	yield* dispatchPopulationPlans(
		swept.dispatch,
		"provider related sweep completed with automation warnings",
		{ relationshipSchemaSlug: run.group.relationshipSchemaSlug },
	);
	return "complete" as const;
});

/** Writes a group's later pages, one transaction each, and sweeps an authoritative group once they are all in. */
const finishRelatedGroup = Effect.fn("finishRelatedGroup")(function* (
	payload: PopulationWritePayload,
	definitions: EntityRelationshipDefinitions,
	run: RelatedGroupRun,
	firstPage: { readonly coverage: ProviderDetailsRelatedEntityGroup["coverage"] },
	firstKept: ReadonlyArray<EntityId>,
) {
	const operations = yield* EntityImportWorkflowOperations;
	const kept = new Set(firstKept);
	let coverage = firstPage.coverage;
	const seenContinuations = new Set<string>();
	for (let pageIndex = 1; coverage.status === "more"; pageIndex += 1) {
		if (pageIndex >= RELATED_PAGES_MAX_PAGES) {
			return yield* new SandboxRunError({
				kind: "invalid-output",
				message: "Related entity pages reached the page limit",
			});
		}
		const continuation: JsonValue = coverage.continuation;
		const continuationKey = stableStringify(continuation);
		if (seenContinuations.has(continuationKey)) {
			return yield* new SandboxRunError({
				kind: "invalid-output",
				message: "Related entity pages repeated a continuation without completing",
			});
		}
		seenContinuations.add(continuationKey);
		const sandboxResult = yield* operations.processRelatedPage(
			{ ...payload, group: run.group },
			`${payload.executionId}-sandbox-related-${run.index}-${pageIndex}`,
			continuation,
		);
		if (sandboxResult.error) {
			return yield* new SandboxRunError({
				kind: sandboxResult.error.kind,
				message: sandboxResult.error.message,
				...(sandboxResult.error.data === undefined ? {} : { data: sandboxResult.error.data }),
			});
		}
		const page = yield* Schema.decodeUnknownEffect(providerRelatedResultSchema)(
			sandboxResult.value,
		).pipe(
			Effect.mapError(
				(error) =>
					new SandboxRunError({
						kind: "invalid-output",
						message: `Invalid related entities: ${error.message}`,
					}),
			),
		);
		if (page.coverage.status === "source-limited") {
			return yield* new SandboxRunError({
				kind: "invalid-output",
				message: `Provider inventory ${run.group.relationshipSchemaSlug} is source-limited: ${page.coverage.reason}`,
			});
		}
		const synchronized = yield* syncRelatedEntityGroupScope(
			payload,
			definitions,
			run.entityId,
			{ ...run.group, entities: page.entities },
			run.index,
			run.population,
			{ pageIndex, generation: run.generation },
		);
		if (synchronized.superseded) {
			yield* logSupersededRelatedGroup(run.entityId, run.group, run.index, pageIndex);
			return "superseded" as const;
		}
		for (const id of synchronized.relatedEntityIds) {
			kept.add(id);
		}
		coverage = page.coverage;
	}
	return run.group.synchronization === "authoritative"
		? yield* sweepRelatedGroup(payload, definitions, run, kept)
		: ("complete" as const);
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
	if (relatedEntityGroups.some(({ coverage }) => coverage.status === "more")) {
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
	yield* requests.attachEntity(requestId, entity.id);
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
	yield* publishPrimaryEntity(payload, stamped.result.entity.id);
	if (options.level === "base") {
		return stamped.result.entity;
	}
	const outcomes = yield* Effect.forEach(relatedEntityGroups, (group, index) =>
		Effect.gen(function* () {
			if (group.coverage.status === "source-limited") {
				return yield* new SandboxRunError({
					kind: "invalid-output",
					message: `Provider inventory ${group.relationshipSchemaSlug} is source-limited: ${group.coverage.reason}`,
				});
			}
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
			return yield* finishRelatedGroup(
				payload,
				definitions,
				{ index, group, population, entityId: entity.id, generation: executionId },
				{ coverage: group.coverage },
				firstPage.relatedEntityIds,
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
	yield* stampRelatedPopulatedAt(payload, entity.id, executionId);
	yield* publishPrimaryEntity(payload, entity.id, "enrichment-updated");
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

export const runPopulationAttempt = Effect.fn("runPopulationAttempt")(
	function* (payload: PopulationWritePayload, executionId: string) {
		const requestId = payload.requestId;
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
			yield* requests.attachEntity(requestId, existing.id);
		}
		if (
			payload.mode === "ensure" &&
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
			{
				level: payload.level,
				entitySchemaSlug: payload.entitySchemaSlug,
				mode: payload.mode === "ensure" ? "initial" : "refresh",
			},
			existing,
			requestId,
		);
	},
	(effect, _payload, executionId) => Effect.annotateLogs(effect, { executionId }),
);

export const EntityPopulationJob = makeJobKind("entity-population", {
	maxAttempts: 3,
	concurrency: 8,
	backoff: Duration.seconds(5),
	payload: Schema.Struct({ requestId: Schema.String }),
});

const retryable = (failure: SandboxRunError) =>
	failure.data === undefined && (failure.kind === "infrastructure" || failure.kind === "timeout");

/**
 * One attempt of a population request. A retryable failure fails the job so it runs again; anything else settles the
 * request here, and the job is done.
 */
export const runEntityPopulationJob = Effect.fn("EntityPopulationJob")(function* (
	{ requestId }: typeof EntityPopulationJob.payload.Type,
	job: JobContext,
) {
	const requests = yield* EnrichmentRequests;
	const sandbox = yield* ScriptExecutionService;
	const row = yield* requests.get(requestId).pipe(mapDbErrorToSandbox);
	if (!row || row.state === "succeeded" || row.state === "failed" || row.state === "cancelled") {
		return yield* Effect.void;
	}
	const release = sandbox
		.releaseWorkflowRegistration(requestId)
		.pipe(Effect.catchCause((cause) => Effect.logWarning("Population release failed", cause)));
	const decoded = yield* Schema.decodeUnknownEffect(ProviderEntityPopulationPayload)(
		row.payload,
	).pipe(Effect.result);
	if (Result.isFailure(decoded)) {
		yield* requests.update(requestId, { state: "failed", failureKind: "invalid-input" });
		return yield* release;
	}
	const payload = decoded.success;
	const attempt = job.attempt;
	yield* requests.update(requestId, { attempt, state: "running", failureKind: null });
	const startedAt = yield* DateTime.nowAsDate;
	const attemptId = `${requestId}-attempt-${attempt}`;
	const result = yield* runPopulationAttempt(
		{
			...payload,
			requestId,
			executionId: attemptId,
			requestAttempt: attempt,
			command: {
				...payload.command,
				occurredAt: IsoUtcString.make(startedAt.toISOString()),
				causation: {
					...payload.command.causation,
					executionId: AutomationExecutionId.make(attemptId),
				},
			},
		},
		attemptId,
	).pipe(
		Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
		Effect.result,
	);
	if (Result.isSuccess(result)) {
		yield* requests.attachEntity(requestId, result.success.id);
		yield* requests.update(requestId, { attempt, failureKind: null, state: "succeeded" });
		yield* release;
		const account = payload.command.accountUserId;
		if (payload.translationLanguage && account !== null) {
			const translations = yield* TranslationsService;
			yield* translations.requestFill({
				userId: account,
				entityId: result.success.id,
				providerId: payload.providerId,
				externalId: payload.externalId,
				lane: payload.command.causation.lane,
				language: payload.translationLanguage,
				entitySchemaPluginId: payload.pluginId,
				entitySchemaSlug: payload.entitySchemaSlug,
				refreshKey: stableStringify([requestId, account]),
			});
		}
		return yield* Effect.void;
	}
	const failure = result.failure;
	if (retryable(failure) && attempt < EntityPopulationJob.maxAttempts) {
		yield* requests.update(requestId, { attempt, state: "retrying", failureKind: failure.kind });
		return yield* failure;
	}
	yield* Effect.logWarning("Provider population failed", {
		attempt,
		requestId,
		kind: failure.kind,
		message: failure.message,
	});
	yield* requests.update(requestId, { attempt, state: "failed", failureKind: failure.kind });
	return yield* release;
});

export const EntityPopulationJobLive = registerJobHandler(
	EntityPopulationJob,
	runEntityPopulationJob,
);
