import { unknownToMessage } from "@ryot-app/contract/errors";
import {
	CreateEventsResponse,
	type EventCreateFailureReason,
} from "@ryot-app/contract/modules/events/schemas";
import {
	type IngestionReason,
	type IngestionScope,
	IngestionSummary,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunFailureStage } from "@ryot-app/contract/modules/imports/types";
import {
	type DefinitionOwner,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	ImportRunId,
	IntegrationId,
	PluginId,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { definitionLookup, DefinitionSnapshot } from "@ryot-app/definitions/snapshot";
import {
	genericImportChunkOperationIds,
	genericImportChunkSchema,
	genericImportItemIntents,
	type GenericImportWriteItem,
} from "@ryot-app/plugin-backend-sdk/imports";
import { providerResolveResultSchema } from "@ryot-app/plugin-backend-sdk/provider";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Option, Ref, Schema, type Scope } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { type Changes, type EntityReference, eventCreateChange } from "#modules/changes/changes";
import { toCreateEventsResponse } from "#modules/changes/outcomes";
import type { CommitResult } from "#modules/changes/receipts";
import { ChangeSets, type CommitOptions } from "#modules/changes/service";
import { CollectionsService } from "#modules/collections/service";
import { DefinitionRepository } from "#modules/definitions/repository";
import { definitionText } from "#modules/definitions/text";
import { awaitEntityImport } from "#modules/entities/providers/entity-import-job";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { idempotencyIdentity, IdempotencyKeys, keyedReceipt } from "#modules/mutations/idempotency";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	sameRevisionPin,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";
import { forgetWorkflowSteps, inWorkflowStepScope, makeActivity } from "#platform/workflow/scope";

import {
	genericIngestionBatchResult,
	genericIngestionFailureOperation,
	genericIngestionOperations,
	type IngestionOperation,
	operationIssue,
	reconcileGenericIngestionBatch,
} from "./batch-results";
import { IngestionCaptures } from "./capture-service";
import { IntegrationEventWrites } from "./integration-event-writes";
import {
	genericImportOperationCommand,
	genericImportOperationIdentity,
	genericImportRecordCommand,
} from "./outcomes";
import { ImportsRepository } from "./repository";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";

export const GenericImportChunkPayload = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	ordinal: Schema.Finite,
	batchId: Schema.NonEmptyString,
	command: DomainLifecycleCommand,
	captureId: Schema.NonEmptyString,
	artifactOwnerExecutionId: Schema.String,
	inputFingerprint: Schema.NonEmptyString,
	integrationId: Schema.optional(IntegrationId),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				(value.command.causation.importRunId === value.runId &&
					(value.integrationId === undefined
						? value.command.causation.source === "import" &&
							value.command.causation.integrationId === undefined
						: value.command.causation.source === "integration" &&
							value.command.causation.integrationId === value.integrationId)) ||
				"Generic import command does not match its trusted integration subject",
		),
	),
);

export const failureReasonByStage = {
	event_policy: { code: "event-policy-failed" },
	source_fetch: { code: "source-fetch-failed" },
	database_commit: { code: "database-commit-failed" },
	provider_details: { code: "provider-details-failed" },
	provider_resolution: { code: "provider-resolution-failed" },
	input_transformation: { code: "input-transformation-failed" },
} as const satisfies Record<ImportRunFailureStage, ImportRunFailureReason>;

/** What an import item's commit wrote: its entities and relationships by item identity, and its events. */
const ImportItemCommitted = Schema.Struct({
	events: CreateEventsResponse,
	entities: Schema.Array(Schema.Struct({ entityId: EntityId, itemIdentity: Schema.String })),
	relationships: Schema.Array(
		Schema.Struct({ itemIdentity: Schema.String, relationshipId: Schema.NullOr(RelationshipId) }),
	),
});

/** The run an import commit records event outcomes in, and each event create's operation by position. */
type ImportEventOutcomes = {
	readonly scope: IngestionScope;
	readonly inputFingerprint: string;
	readonly events: ReadonlyArray<undefined | IngestionOperation>;
};

const eventFailureReason = (reason: EventCreateFailureReason): IngestionReason => ({
	key: null,
	code: failureReasonByStage[
		reason.code === "policy-execution-failed" ? "event_policy" : "database_commit"
	].code,
});

/**
 * Records the outcome and issue of every event create that was skipped by a policy or failed; an event
 * without an operation records nothing.
 */
const recordEventOutcomes = Effect.fn("imports.recordEventOutcomes")(function* (
	target: ImportEventOutcomes,
	events: CreateEventsResponse,
) {
	const repository = yield* ImportsRepository;
	for (const outcome of events.outcomes) {
		const operation = target.events[outcome.index];
		if (operation === undefined || outcome.status === "written") {
			continue;
		}
		const skipped = outcome.status === "skipped_by_policy";
		const reason: IngestionReason = skipped
			? { message: outcome.reason, code: "policy-rejected" }
			: eventFailureReason(outcome.reason);
		if (!skipped) {
			yield* Effect.logWarning("Import event failed", {
				code: outcome.reason.code,
				operationId: operation.operationId,
			});
		}
		yield* repository.recordOutcome(target.scope, {
			...operation,
			reason,
			inputFingerprint: target.inputFingerprint,
			result: skipped ? "skipped" : "unsuccessful",
		});
		yield* repository.recordIssue(
			target.scope,
			operationIssue(operation, skipped ? "warning" : "error", reason),
		);
	}
});

/**
 * Commits one import item once: the account's idempotency key under the item's command identity holds
 * the result, so an activity retried after its commit replays it instead of writing again. The
 * transaction that records the result also records the outcomes of the events it did not write, under
 * the run's outcome locks.
 */
export const commitImportItem = Effect.fn("imports.commitImportItem")(function* (
	changes: Changes & { readonly userId: UserId },
	command: DomainLifecycleCommand,
	options: Omit<CommitOptions, "precondition">,
	outcomes: ImportEventOutcomes,
) {
	const repository = yield* ImportsRepository;
	const identity = idempotencyIdentity({
		request: changes,
		kind: "import-item",
		userId: changes.userId,
		key: command.itemIdentity,
	});
	const receipt = keyedReceipt(
		yield* IdempotencyKeys.make,
		identity,
		ImportItemCommitted,
		(result: CommitResult) => ({
			events: toCreateEventsResponse(result.outcomes),
			entities: result.entities.map(({ entity, itemIdentity }) => ({
				itemIdentity,
				entityId: entity.id,
			})),
			relationships: result.relationships.map(({ itemIdentity, relationship }) => ({
				itemIdentity,
				relationshipId: relationship?.id ?? null,
			})),
		}),
	);
	const recorded = (committed: typeof ImportItemCommitted.Type) =>
		recordEventOutcomes(outcomes, committed.events).pipe(
			Effect.catchTags({ SchemaError: Effect.die, DatabaseSessionStateError: Effect.die }),
			Effect.provideService(ImportsRepository, repository),
		);
	return yield* (yield* ChangeSets).commitOnce(
		changes,
		command,
		{ ...receipt, record: (result) => Effect.tap(receipt.record(result), recorded) },
		{
			...options,
			precondition: {
				written: () => Effect.void,
				check: () => Effect.succeed(true),
				lock: (transaction) =>
					repository
						.lockOutcomes(outcomes.scope, transaction)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
			},
		},
	);
});

const GenericImportProvider = Schema.Struct({
	pluginId: PluginId,
	id: SandboxProviderId,
	pluginScope: Schema.Literals(["system", "user"]),
});

export class GenericImportProviderError extends Schema.TaggedError<
	GenericImportProviderError,
	{ readonly brand: unique symbol }
>()("GenericImportProviderError", {
	message: Schema.String,
	stage: Schema.Literals(["provider_resolution", "provider_details"]),
}) {}

const resolveGenericImportProvider = (
	intent: GenericImportWriteItem["entities"][number],
	userId: UserId,
	executionId: string,
	owner: DefinitionOwner,
) =>
	makeActivity({
		error: ImportRunError,
		success: GenericImportProvider,
		name: `resolve-generic-import-provider-${executionId}`,
		execute: Effect.gen(function* () {
			const descriptor = intent.providerResolution;
			if (!descriptor) {
				return yield* new ImportRunError({ message: "Provider resolution descriptor is missing" });
			}
			const runtime = yield* PluginRuntimeResolver;
			const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
				owner,
				slug: descriptor.providerSlug,
			});
			if (!provider) {
				return yield* new ImportRunError({
					message: `Provider '${descriptor.providerSlug}' is unavailable`,
				});
			}
			if (
				owner.kind !== "plugin" ||
				provider.pluginId !== owner.pluginId ||
				provider.rootEntitySchemaSlug !== intent.entitySchemaSlug
			) {
				return yield* new ImportRunError({
					message: `Provider '${descriptor.providerSlug}' does not provide entity schema '${intent.entitySchemaSlug}'`,
				});
			}
			return {
				id: provider.id,
				pluginScope: provider.pluginScope,
				pluginId: PluginId.make(provider.pluginId),
			};
		}).pipe(Effect.mapError(toWorkflowError)),
	});

export const resolveProviderEntity = Effect.fn("imports.resolveProviderEntity")(function* (
	intent: GenericImportWriteItem["entities"][number],
	userId: UserId,
	command: DomainLifecycleCommand,
	executionId: string,
	owner: DefinitionOwner,
) {
	const descriptor = intent.providerResolution;
	if (!descriptor) {
		return undefined;
	}
	const provider = yield* resolveGenericImportProvider(intent, userId, executionId, owner).pipe(
		Effect.mapError(
			(error) =>
				new GenericImportProviderError({ message: error.message, stage: "provider_resolution" }),
		),
	);
	const operations = yield* EntityImportWorkflowOperations;
	const resolved = yield* operations
		.processProviderResolve(
			{
				accountUserId: userId,
				providerId: provider.id,
				value: descriptor.value,
				lane: command.causation.lane,
				writeContext: command.writeContext,
				identifierType: descriptor.identifierType,
				userId: provider.pluginScope === "user" ? userId : null,
			},
			`${executionId}-resolve`,
		)
		.pipe(
			Effect.flatMap((result) =>
				result.error
					? Effect.fail(
							new GenericImportProviderError({
								stage: "provider_resolution",
								message: result.error.message,
							}),
						)
					: Schema.decodeUnknownEffect(providerResolveResultSchema)(result.value).pipe(
							Effect.mapError(
								(error) =>
									new GenericImportProviderError({
										stage: "provider_resolution",
										message: `Invalid provider resolution result: ${error.message}`,
									}),
							),
						),
			),
			Effect.mapError((error) =>
				error instanceof GenericImportProviderError
					? error
					: new GenericImportProviderError({
							stage: "provider_resolution",
							message: unknownToMessage(error),
						}),
			),
		);
	if (resolved.externalId === null) {
		return undefined;
	}
	const importCommand =
		command.writeContext === null
			? {
					...command,
					writeContext: yield* operations
						.preRegisterProviderImport(
							{
								userId,
								accountUserId: userId,
								providerId: provider.id,
								pluginId: provider.pluginId,
							},
							executionId,
						)
						.pipe(
							Effect.mapError(
								(error) =>
									new GenericImportProviderError({
										message: error.message,
										stage: "provider_details",
									}),
							),
						),
				}
			: command;
	const providerEntity = yield* awaitEntityImport({
		executionId,
		command: importCommand,
		providerId: provider.id,
		pluginId: provider.pluginId,
		externalId: resolved.externalId,
		entitySchemaSlug: EntitySchemaSlug.make(intent.entitySchemaSlug),
		entityScope: { userId, type: provider.pluginScope === "system" ? "global" : "user" },
	}).pipe(
		Effect.mapError(
			(error) =>
				new GenericImportProviderError({ message: error.message, stage: "provider_details" }),
		),
	);
	return providerEntity.id;
});

type GenericImportDefinitions = ReturnType<typeof definitionLookup>;

/**
 * How an item's events commit: an item with an event of a declared event group commits its events
 * all-or-nothing, and needs a user-owned subject and no coalesced event; any other item's events are
 * independent creates. The commit checks everything else the item writes.
 */
const genericItemEvents = Effect.fn("imports.genericItemEvents")(function* (
	item: GenericImportWriteItem,
	userId: UserId,
	definitions: GenericImportDefinitions,
	pluginId: PluginId,
) {
	const subjectIds = item.events.flatMap(({ subjectEntityId }) =>
		subjectEntityId === undefined ? [] : [EntityId.make(subjectEntityId)],
	);
	const subjects =
		subjectIds.length === 0
			? undefined
			: yield* (yield* EntitiesRepository).getEntityScopesForUser(subjectIds, userId);
	const owner = definitionOwner(pluginId);
	const grouped = item.events.some((event) => {
		let entitySchemaSlug: string | undefined;
		if (event.subjectEntityId === undefined) {
			entitySchemaSlug = item.entities.find(
				({ alias }) => alias === event.entityAlias,
			)?.entitySchemaSlug;
		} else {
			const subject = subjects?.get(EntityId.make(event.subjectEntityId));
			entitySchemaSlug =
				subject?.entitySchemaPluginId === pluginId ? subject.entitySchemaSlug : undefined;
		}
		const entitySchema =
			entitySchemaSlug === undefined
				? undefined
				: definitions.getEntitySchema({ owner, slug: EntitySchemaSlug.make(entitySchemaSlug) });
		return Object.values(entitySchema?.eventSchemas ?? {}).some(
			(schema) =>
				schema.eventGroup !== undefined &&
				(schema.slug === event.eventSchemaSlug ||
					schema.eventGroup.dependents.some(
						(dependent) => dependent.eventSchemaSlug === event.eventSchemaSlug,
					)),
		);
	});
	if (!grouped) {
		return { independent: true, verbatimIdentities: true } as const;
	}
	if (item.events.some((event) => event.coalescing !== undefined)) {
		return yield* new ImportRunError({ message: "Event-group imports cannot coalesce events" });
	}
	const subject = item.entities.find((intent) => intent.alias === item.subjectEntityAlias);
	if (!subject || subject.providerResolution || subject.scope === "global") {
		return yield* new ImportRunError({
			message: "An event-group import requires a user-owned subject entity",
		});
	}
	return { verbatimIdentities: true } as const;
});

const unknownAlias = (alias: string) =>
	new ImportRunError({ message: `Import intent references an unknown entity alias '${alias}'` });

/**
 * The item as one change set: its entities by alias, relationships, events other than coalesced ones,
 * and collection memberships. An entity resolved through its provider is referenced, or preferred by
 * its match; any other is created unless its entity ID or match finds one.
 */
const genericItemChanges = Effect.fnUntraced(function* (
	item: GenericImportWriteItem,
	userId: UserId,
	command: DomainLifecycleCommand,
	owner: DefinitionOwner,
	resolved: ReadonlyMap<string, EntityId>,
	membershipFields: Readonly<Record<string, unknown>>,
) {
	const identity = (operationId: string) =>
		genericImportOperationIdentity(command.causation.importRunId, item, operationId);
	const aliases = new Set(item.entities.map(({ alias }) => alias));
	const keyed = (alias: string) =>
		aliases.has(alias)
			? Effect.succeed({ key: alias, kind: "keyed" as const })
			: Effect.fail(unknownAlias(alias));
	const entitySchema = (slug: string) => ({ owner, slug: EntitySchemaSlug.make(slug) });
	const requested = item.collectionMemberships ?? [];
	const memberships =
		requested.length === 0
			? { creates: [], relationships: { events: [], upserts: [] } }
			: yield* (yield* CollectionsService).namedMemberships({
					membershipFields,
					occurredAt: command.occurredAt,
					memberships: yield* Effect.forEach(requested, (membership) => {
						const member = item.entities.find(({ alias }) => alias === membership.entityAlias);
						return member === undefined
							? Effect.fail(unknownAlias(membership.entityAlias))
							: Effect.succeed({
									collectionName: membership.collectionName,
									memberSchemaSlug: member.entitySchemaSlug,
									itemIdentity: identity(membership.operationId),
									member: { key: member.alias, kind: "keyed" as const },
								});
					}),
				});
	return {
		userId,
		events: {
			changes: yield* Effect.forEach(
				item.events.filter((event) => event.coalescing === undefined),
				(event) =>
					Effect.gen(function* () {
						return eventCreateChange<EntityReference>(identity(event.operationId), {
							occurredAt: event.occurredAt,
							properties: event.properties,
							eventSchemaSlug: event.eventSchemaSlug,
							entity:
								event.subjectEntityId === undefined
									? yield* keyed(event.entityAlias)
									: { kind: "existing", entityId: EntityId.make(event.subjectEntityId) },
							session: event.sessionEntityAlias
								? yield* keyed(event.sessionEntityAlias)
								: undefined,
						});
					}),
			),
		},
		relationships: {
			events: memberships.relationships.events,
			upserts: [
				...(yield* Effect.forEach(item.relationships, (relationship) =>
					Effect.gen(function* () {
						return {
							properties: relationship.properties,
							source: yield* keyed(relationship.sourceAlias),
							target: yield* keyed(relationship.targetAlias),
							itemIdentity: identity(relationship.operationId),
							propertiesMode: relationship.propertiesMode ?? "replace",
							...(relationship.key === undefined ? {} : { key: relationship.key }),
							relationshipSchema: {
								owner,
								slug: RelationshipSchemaSlug.make(relationship.relationshipSchemaSlug),
							},
						} as const;
					}),
				)),
				...memberships.relationships.upserts,
			],
		},
		entities: {
			references: item.entities.flatMap((intent) => {
				const entityId = resolved.get(intent.alias);
				return entityId === undefined || intent.match
					? []
					: [
							{
								entityId,
								key: intent.alias,
								itemIdentity: identity(intent.operationId),
								entitySchema: entitySchema(intent.entitySchemaSlug),
							},
						];
			}),
			creates: [
				...item.entities.flatMap((intent) => {
					const prefer = resolved.get(intent.alias);
					if (prefer !== undefined && !intent.match) {
						return [];
					}
					const scope = intent.scope ? { scope: intent.scope } : {};
					const required = intent.existingOnly === true;
					let match;
					if (intent.entityId) {
						match = { ...scope, required, entityId: EntityId.make(intent.entityId) };
					} else if (intent.match) {
						match = {
							...scope,
							required,
							name: intent.match.name,
							properties: intent.match.properties,
							nameNormalization: intent.match.nameNormalization ?? "exact",
							...(prefer === undefined ? {} : { prefer }),
						};
					}
					return [
						{
							name: intent.name,
							key: intent.alias,
							properties: intent.properties,
							itemIdentity: identity(intent.operationId),
							entitySchema: entitySchema(intent.entitySchemaSlug),
							...(match ? { match } : {}),
						},
					];
				}),
				...memberships.creates,
			],
		},
	} satisfies Changes;
});

/**
 * Resolves the item's provider entities, then commits the item as one change set. An event-group
 * record commits atomically; a standalone record's events have their own outcomes.
 */
const writeGenericItem = Effect.fn("imports.writeGenericItem")(function* (
	item: GenericImportWriteItem,
	userId: UserId,
	index: number,
	definitions: GenericImportDefinitions,
	command: DomainLifecycleCommand,
	pluginRevision: ScriptPluginRevision,
	membershipFields: Readonly<Record<string, unknown>>,
	outcomes: ImportEventOutcomes,
) {
	const owner = definitionOwner(pluginRevision.id);
	const writeItem = Effect.fnUntraced(function* () {
		if (
			command.causation.integrationId === undefined &&
			item.events.some((event) => event.coalescing)
		) {
			return yield* new ImportRunError({
				message: "Only admitted integrations can coalesce import events",
			});
		}
		const aliases = new Set<string>();
		for (const intent of item.entities) {
			if (aliases.has(intent.alias)) {
				return yield* new ImportRunError({
					message: `Duplicate import entity alias '${intent.alias}'`,
				});
			}
			aliases.add(intent.alias);
			if (intent.existingOnly && !intent.entityId && !intent.match) {
				return yield* new ImportRunError({
					message: `Required import entity '${intent.alias}' was not found`,
				});
			}
			if (pluginRevision.scope === "user" && intent.scope === "global") {
				return yield* new ImportRunError({
					message: "Import entity exceeds the invoking plugin's write authority",
				});
			}
		}
		if (!aliases.has(item.subjectEntityAlias)) {
			return yield* unknownAlias(item.subjectEntityAlias);
		}
		for (const membership of item.collectionMemberships ?? []) {
			if (!aliases.has(membership.entityAlias)) {
				return yield* unknownAlias(membership.entityAlias);
			}
		}
		const providers = item.entities.filter((intent) => intent.providerResolution);
		const resolved = new Map<string, EntityId>();
		for (const intent of providers) {
			const entityId = yield* resolveProviderEntity(
				intent,
				userId,
				genericImportOperationCommand(command, item, intent.operationId),
				stableStringify([command.causation.importRunId, "provider", intent.operationId]),
				owner,
			);
			if (entityId) {
				resolved.set(intent.alias, entityId);
			}
		}
		const committed = yield* makeActivity({
			error: ImportRunError,
			success: ImportItemCommitted,
			name: `commit-generic-import-item-${index}`,
			execute: Effect.gen(function* () {
				return yield* commitImportItem(
					yield* genericItemChanges(item, userId, command, owner, resolved, membershipFields),
					genericImportRecordCommand(command, item),
					{
						entities: { verbatimIdentities: true },
						relationships: { verbatimIdentities: true },
						events: yield* genericItemEvents(item, userId, definitions, pluginRevision.id),
					},
					outcomes,
				);
			}).pipe(Effect.mapError(toWorkflowError)),
		});
		const entityIds = new Map(
			committed.entities.map(({ entityId, itemIdentity }) => [itemIdentity, entityId]),
		);
		const written = new Map(
			item.entities.flatMap((intent) => {
				const entityId = entityIds.get(
					genericImportOperationIdentity(command.causation.importRunId, item, intent.operationId),
				);
				return entityId === undefined ? [] : [[intent.alias, entityId] as const];
			}),
		);
		return { committed, aliases: written, _tag: "ready" as const };
	});
	return yield* writeItem().pipe(
		Effect.catch((error) =>
			Effect.succeed({
				_tag: "failed" as const,
				message: unknownToMessage(error),
				stage:
					error instanceof GenericImportProviderError ? error.stage : ("database_commit" as const),
			}),
		),
	);
});

const resolveGenericImportDefinitions = (userId: UserId, pluginRevision: ScriptPluginRevision) =>
	makeActivity({
		error: ImportRunError,
		success: DefinitionSnapshot,
		name: "resolve-generic-import-definitions",
		execute: Effect.flatMap(DefinitionRepository, (definitions) =>
			definitions.getSnapshotForContext(
				{ pluginId: pluginRevision.id, pluginRevisionId: pluginRevision.revisionId },
				userId,
			),
		).pipe(Effect.mapError(toWorkflowError)),
	});

export const runGenericImportChunk = Effect.fn("runGenericImportChunk")(
	function* (payload: typeof GenericImportChunkPayload.Type) {
		const keys = yield* IdempotencyKeys.make;
		if (!payload.command.accountUserId) {
			return yield* new ImportRunError({ message: "Ingestion account is missing" });
		}
		const scope: IngestionScope = { runId: payload.runId, userId: payload.userId };
		const repository = yield* ImportsRepository;
		const database = yield* DatabaseSession;
		const captures = yield* IngestionCaptures;
		const previous = yield* repository.getBatch(scope, payload.batchId);
		if (
			previous &&
			(previous.captureId !== payload.captureId ||
				previous.ordinal !== payload.ordinal ||
				previous.inputFingerprint !== payload.inputFingerprint)
		) {
			return yield* new ImportRunError({ message: "Ingestion batch identity changed" });
		}
		const capture = yield* repository.getCapture(scope, payload.captureId);
		if (capture?.payload?.checksum !== payload.inputFingerprint) {
			return yield* new ImportRunError({
				message: "Ingestion batch fingerprint does not match its capture",
			});
		}
		const chunk = yield* Schema.decodeEffect(Schema.fromJsonString(genericImportChunkSchema))(
			new TextDecoder().decode(yield* captures.read(scope, payload.captureId, 4 * 1024 * 1024)),
		).pipe(Effect.mapError(toWorkflowError));
		if (previous?.state === "applied") {
			return yield* genericIngestionBatchResult(scope, previous, chunk);
		}
		const batch = {
			summary: [],
			id: payload.batchId,
			ordinal: payload.ordinal,
			state: "pending" as const,
			captureId: payload.captureId,
			inputFingerprint: payload.inputFingerprint,
		};
		yield* makeActivity({
			error: ImportRunError,
			name: "register-ingestion-batch",
			execute: database
				.transaction(
					Effect.gen(function* () {
						yield* repository.registerBatch(scope, batch, genericImportChunkOperationIds(chunk));
						yield* repository.startBatch(scope, batch.id);
					}),
				)
				.pipe(Effect.mapError(toWorkflowError)),
		});
		const operations = genericIngestionOperations(chunk, scope.runId);
		const record = Effect.fnUntraced(function* (
			operation: IngestionOperation,
			result: "skipped" | "unsuccessful",
			reason: IngestionReason,
		) {
			const outcome = { ...operation, result, reason, inputFingerprint: payload.inputFingerprint };
			yield* makeActivity({
				error: ImportRunError,
				name: `record-ingestion-result:${operation.operationId}`,
				execute: database
					.transaction(
						Effect.gen(function* () {
							yield* repository.recordOutcome(scope, outcome);
							yield* repository.recordIssue(
								scope,
								operationIssue(operation, result === "unsuccessful" ? "error" : "warning", reason),
							);
						}),
					)
					.pipe(Effect.mapError(toWorkflowError)),
			});
		});
		const sourceState = yield* (yield* ImportSourceStateStore)
			.load(scope)
			.pipe(Effect.mapError(toWorkflowError));
		const admitted = yield* repository.getIngestionRunControl(scope);
		if (
			payload.command.writeContext?.pluginRevision?.id !== sourceState.pluginId ||
			!sameRevisionPin(payload.command.writeContext.pluginRevision, sourceState.pluginRevision)
		) {
			return yield* new ImportRunError({
				message: "Generic import requires the original trusted caller authority",
			});
		}
		if (
			!admitted?.pins ||
			admitted.pluginInstallationId !== sourceState.pluginInstallationId ||
			admitted.pins.executionId !== payload.artifactOwnerExecutionId ||
			admitted.pins.pluginRevisionId !== sourceState.pluginRevision.revisionId ||
			admitted.pins.pluginConfigRevisionId !== sourceState.pluginRevision.configRevisionId ||
			sourceState.pluginId !== sourceState.pluginRevision.id
		) {
			return yield* new ImportRunError({
				message: "Generic import caller does not match the admitted plugin pin",
			});
		}
		const runtime = yield* PluginRuntimeResolver;
		const active = yield* runtime.findPluginAvailableToUser(payload.userId, sourceState.pluginId);
		if (active?.installationId !== sourceState.pluginInstallationId) {
			return yield* new ImportRunError({ message: "Generic import installation is unavailable" });
		}
		const snapshot = yield* resolveGenericImportDefinitions(
			payload.userId,
			sourceState.pluginRevision,
		);
		const definitions = definitionLookup(snapshot);
		const collectionNames = chunk.items.flatMap((item) =>
			(item.collectionMemberships ?? []).map(({ collectionName }) => collectionName),
		);
		const membershipFields =
			collectionNames.length === 0
				? {}
				: yield* makeActivity({
						error: ImportRunError,
						name: "resolve-import-collections",
						success: Schema.Record(Schema.String, Schema.Unknown),
						execute: (yield* CollectionsService)
							.membershipFieldsByName(payload.userId, collectionNames)
							.pipe(Effect.mapError(toWorkflowError)),
					});
		for (const failure of chunk.failures) {
			const stage = failure.stage ?? "input_transformation";
			yield* record(genericIngestionFailureOperation(failure, scope.runId), "unsuccessful", {
				key: null,
				code: failureReasonByStage[stage].code,
				...(failure.detail === undefined
					? {}
					: { detail: definitionText(sourceState.pluginId, failure.detail) }),
			});
		}
		for (const [index, item] of chunk.items.entries()) {
			const run = yield* repository.getIngestionRunControl(scope);
			if (run?.status !== "running") {
				break;
			}
			const operationOf = (operationId: string) =>
				operations.find((value) => value.operationId === operationId);
			const outcomesOf = (events: GenericImportWriteItem["events"]) => ({
				scope,
				inputFingerprint: payload.inputFingerprint,
				events: events.map(({ operationId }) => operationOf(operationId)),
			});
			const outcome = yield* writeGenericItem(
				item,
				payload.userId,
				index,
				definitions,
				payload.command,
				sourceState.pluginRevision,
				membershipFields,
				outcomesOf(item.events.filter((event) => event.coalescing === undefined)),
			);
			let failureCode: null | string =
				outcome._tag === "failed" ? failureReasonByStage[outcome.stage].code : null;
			if (outcome._tag === "ready") {
				const { aliases, committed } = outcome;
				const failure = committed.events.failure;
				failureCode ??= failure ? eventFailureReason(failure.reason).code : null;
				const written = new Set(committed.relationships.map(({ itemIdentity }) => itemIdentity));
				for (const { operationId } of item.collectionMemberships ?? []) {
					if (written.has(genericImportOperationIdentity(scope.runId, item, operationId))) {
						continue;
					}
					failureCode ??= "membership-event-failed";
					const operation = operationOf(operationId);
					if (operation) {
						yield* record(operation, "unsuccessful", {
							key: null,
							code: "membership-event-failed",
						});
					}
				}
				for (const [groupIndex, intent] of item.events.entries()) {
					const { coalescing } = intent;
					if (!coalescing) {
						continue;
					}
					const integrationId = payload.integrationId;
					if (!integrationId) {
						return yield* new ImportRunError({ message: "Missing event stream integration" });
					}
					const entityId =
						intent.subjectEntityId === undefined
							? aliases.get(intent.entityAlias)
							: EntityId.make(intent.subjectEntityId);
					if (entityId === undefined) {
						continue;
					}
					const sessionEntityId = intent.sessionEntityAlias
						? aliases.get(intent.sessionEntityAlias)
						: undefined;
					const eventSchemaSlug = EventSchemaSlug.make(intent.eventSchemaSlug);
					const result = yield* makeActivity({
						error: ImportRunError,
						success: CreateEventsResponse,
						name: `create-import-events-${item.itemIndex}-${groupIndex}`,
						execute: (yield* IntegrationEventWrites)
							.apply({
								coalescing,
								key: { entityId, integrationId, eventSchemaSlug, userId: payload.userId },
								identity: genericImportOperationIdentity(scope.runId, item, intent.operationId),
								command: {
									...payload.command,
									itemIdentity: stableStringify(["ingestion-event-group", [intent.operationId]]),
								},
								event: {
									entityId,
									eventSchemaSlug,
									occurredAt: intent.occurredAt,
									properties: intent.properties,
									...(sessionEntityId ? { sessionEntityId } : {}),
								},
							})
							.pipe(Effect.mapError(toWorkflowError)),
					});
					if (result.outcomes.some(({ status }) => status !== "written")) {
						yield* makeActivity({
							error: ImportRunError,
							name: `record-import-events-${item.itemIndex}-${groupIndex}`,
							execute: database
								.transaction(recordEventOutcomes(outcomesOf([intent]), result))
								.pipe(Effect.mapError(toWorkflowError)),
						});
					}
				}
			}
			if (failureCode !== null) {
				const reason = { key: null, code: failureCode };
				const candidates = operations.filter((operation) =>
					genericImportItemIntents(item).some(
						(intent) => intent.operationId === operation.operationId,
					),
				);
				yield* makeActivity({
					error: ImportRunError,
					name: `record-unsuccessful-intents-${index}`,
					execute: database
						.transaction(
							Effect.gen(function* () {
								if ((yield* repository.getIngestionRunControl(scope))?.status !== "running") {
									return;
								}
								const committed = new Set(
									(yield* keys.importItems({
										runId: scope.runId,
										userId: scope.userId,
										itemIdentities: candidates.map((operation) => operation.itemIdentity),
									})).map(({ itemIdentity }) => itemIdentity),
								);
								const recorded = yield* repository.recordedOutcomeIds(
									scope,
									candidates.map((operation) => operation.operationId),
								);
								for (const operation of candidates) {
									if (
										committed.has(operation.itemIdentity) ||
										recorded.has(operation.operationId)
									) {
										continue;
									}
									yield* repository.recordOutcome(scope, {
										...operation,
										reason,
										result: "unsuccessful",
										inputFingerprint: payload.inputFingerprint,
									});
									yield* repository.recordIssue(scope, operationIssue(operation, "error", reason));
								}
							}),
						)
						.pipe(Effect.mapError(toWorkflowError)),
				});
			}
		}
		const summary = yield* makeActivity({
			error: ImportRunError,
			success: IngestionSummary,
			name: "project-ingestion-batch",
			execute: reconcileGenericIngestionBatch(scope, batch).pipe(Effect.mapError(toWorkflowError)),
		});
		const result = yield* genericIngestionBatchResult(scope, { ...batch, summary }, chunk);
		yield* forgetWorkflowSteps(payload.batchId);
		return result;
	},
	(effect, payload) =>
		effect.pipe(inWorkflowStepScope(payload.batchId), Effect.mapError(toWorkflowError)),
);

type GenericImportChunkRun = (
	payload: typeof GenericImportChunkPayload.Type,
) => Effect.Effect<
	Effect.Success<ReturnType<typeof runGenericImportChunk>>,
	ImportRunError,
	WorkflowEngine | WorkflowInstance
>;

/**
 * Applies a chunk in the plugin script's workflow that sent it. Chunks write through services that themselves need
 * scripts, so the runtime installs this once those exist.
 */
export class GenericImportChunks extends Context.Service<
	GenericImportChunks,
	{
		readonly apply: GenericImportChunkRun;
		readonly install: (run: GenericImportChunkRun) => Effect.Effect<void, never, Scope.Scope>;
	}
>()("@ryot-app/kernel-backend/modules/imports/generic-import-workflow/GenericImportChunks") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const installed = yield* Ref.make(Option.none<GenericImportChunkRun>());
			return {
				install: (run) =>
					Effect.acquireRelease(Ref.set(installed, Option.some(run)), () =>
						Ref.set(installed, Option.none()),
					),
				apply: (payload) =>
					Effect.flatMap(Ref.get(installed), (run) =>
						Option.isNone(run) ? Effect.die("Import chunks are not installed") : run.value(payload),
					),
			};
		}),
	);
}

export const GenericImportChunksInstalledLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const services =
			yield* Effect.context<
				Exclude<
					Effect.Services<ReturnType<typeof runGenericImportChunk>>,
					WorkflowEngine | WorkflowInstance
				>
			>();
		yield* (yield* GenericImportChunks).install((payload) =>
			runGenericImportChunk(payload).pipe(Effect.provideContext(services)),
		);
	}),
);
