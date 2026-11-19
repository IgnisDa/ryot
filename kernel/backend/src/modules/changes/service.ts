import { BadRequest, DbError, NotFound, ValidationFailed } from "@ryot-app/contract/errors";
import type {
	ChangeSet,
	ChangeSetEntityReference,
	CommittedChanges,
} from "@ryot-app/contract/modules/changes/change-set";
import {
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
} from "@ryot-app/contract/modules/entities/schemas";
import {
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
} from "@ryot-app/contract/modules/entity-user-data/schemas";
import {
	CreateEventsResponse,
	EventBadRequest,
	EventCreateItemError,
	type EventCreateItemOutcome,
	EventNotFound,
	EventStale,
} from "@ryot-app/contract/modules/events/schemas";
import {
	NotificationAdmissionConflictError,
	NotificationAdmissionUnavailableError,
} from "@ryot-app/contract/modules/notifications/schemas";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import {
	EntityId,
	type EventId,
	EventSchemaSlug,
	SignalSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Context, Effect, Layer, Result, Schema } from "effect";

import { ManagedAssetReferenceRejected } from "#lib/domain/managed-asset-writes";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecycleDispatchPlan,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import {
	AutomationPolicyExecutionError,
	type LifecyclePolicies,
	type PolicyBatchResult,
} from "#modules/automations/lifecycle/policies";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { DefinitionReadUnavailable } from "#modules/definitions/read-context";
import { FoldMarks } from "#modules/derived-values/marks";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	EntitiesService,
	entityDeleteEvents,
	userEntitySaveDraft,
} from "#modules/entities/service";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import {
	type DomainLifecycleCommand,
	DomainWriteConflict,
	kernelCollectionLifecycleCommand,
	reuseLockedWriteChecks,
} from "#modules/entities/write-context";
import { eventReferenceBadRequest } from "#modules/events/event-references";
import {
	acceptedEventBatches,
	applyEventPolicies,
	type EventMutation,
	EventMutations,
	matchesExpectedFields,
	matchEventPolicies,
	type PreparedEventChanges,
} from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import { idempotencyIdentity, IdempotencyKeys } from "#modules/mutations/idempotency";
import { NotificationsService } from "#modules/notifications/service";
import {
	PluginUserSettingsPatchError,
	PluginUserSettingsWriter,
} from "#modules/plugins/preferences/user-settings-writer";
import type {
	PreparedUserRelationshipCreate,
	PreparedUserRelationshipDelete,
} from "#modules/relationships/prepared-mutations";
import { RelationshipsService } from "#modules/relationships/service";
import { shareExecutionAuthority } from "#modules/scripts/authorization/authority";
import {
	principalOwner,
	type ScriptExecutionPrincipal,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";

import {
	authorizeChangeSet,
	type ChangeSetAuthority,
	changeSetReferences,
	ChangeSetRejected,
	undeclaredSchema,
} from "./authority";
import { type Changes, fromScriptChangeSet, type GlobalEntityReference } from "./changes";
import {
	commitRejection,
	EventCreateRejected,
	policyOutcomes,
	rejectedOutcomes,
	sortedOutcomes,
	toCreateEventsResponse,
} from "./outcomes";
import { type CommitReceipt, type CommitResult, keyedReceipt } from "./receipts";

export const ChangeSetFailure = Schema.Union([
	DbError,
	NotFound,
	BadRequest,
	ValidationFailed,
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
	EventBadRequest,
	EventNotFound,
	EventStale,
	EventCreateItemError,
	RelationshipBadRequest,
	RelationshipNotFound,
	DomainWriteConflict,
	ManagedAssetReferenceRejected,
	DefinitionReadUnavailable,
	NotificationAdmissionConflictError,
	NotificationAdmissionUnavailableError,
	AutomationPolicyExecutionError,
	PluginUserSettingsPatchError,
	ChangeSetRejected,
]);

/**
 * Durable state the commit consults: `check` runs before preparation and again in the commit
 * transaction, where false records an empty result; `written` runs after source writes that wrote an
 * event.
 */
export type CommitPrecondition = {
	readonly written: Effect.Effect<void, DbError>;
	readonly check: Effect.Effect<boolean, DbError>;
};

export type CommitOptions = {
	readonly precondition?: CommitPrecondition;
	readonly events?: { readonly independent: true; readonly verbatimIdentities?: true };
};

type Writer =
	| { readonly kind: "kernel" }
	| {
			readonly kind: "script";
			readonly authority: ChangeSetAuthority;
			readonly principal: ScriptExecutionPrincipal;
	  };

const parts = (changes: ChangeSet) => [
	changes.entity,
	changes.folds,
	changes.signals,
	changes.notifications,
	changes.globalEntities,
	changes.globalRelationships,
	changes.events?.creates,
	changes.events?.changes,
	changes.entities?.deletes,
	changes.entities?.clears,
	changes.entities?.merges,
	changes.entities?.updates,
	changes.entities?.ensures,
	changes.relationships?.upserts,
	changes.relationships?.deletes,
	changes.settings === undefined ? undefined : Object.keys(changes.settings),
];

/** Whether committing the change set would write nothing. */
const isEmptyChangeSet = (changes: ChangeSet) =>
	parts(changes).every((part) => part === undefined || (Array.isArray(part) && part.length === 0));

/** A part only a script writer's principal resolves. */
const scriptOnlyPart = (changes: Changes) =>
	(
		[
			["settings", changes.settings !== undefined],
			["folds", changes.folds !== undefined],
			["signals", changes.signals !== undefined],
			["globalEntities", changes.globalEntities !== undefined],
			["globalRelationships", changes.globalRelationships !== undefined],
			["events.expected", changes.events?.expected !== undefined],
			["events.baselines", changes.events?.baselines !== undefined],
		] as const
	).find(([, present]) => present)?.[0];

const itemCommand = (command: DomainLifecycleCommand, itemIdentity: string) => ({
	...command,
	itemIdentity: `${command.itemIdentity}:${itemIdentity}`,
});

const prefixed =
	(prefix: string) =>
	(change: EventMutation): EventMutation => ({
		...change,
		itemIdentity: `${prefix}:${change.itemIdentity}`,
	});

const rootRequired = () => new EventBadRequest({ reason: { code: "root-entity-required" } });

const referencedEntity = (reference: ChangeSetEntityReference, rootId?: EntityId) => {
	if (reference.kind === "existing") {
		return Effect.succeed(reference.entityId);
	}
	return rootId === undefined ? Effect.fail(rootRequired()) : Effect.succeed(rootId);
};

const upsertKey = (entitySchemaSlug: string, externalId: string) =>
	stableStringify([entitySchemaSlug, externalId]);

const globalReferences = (group: NonNullable<Changes["globalRelationships"]>[number]) => [
	...(group.selector.type === "anchored" ? [group.selector.anchor] : []),
	...group.relationships.flatMap(({ source, target }) => [source, target]),
];

type PreparedEventChange = PreparedEventChanges["items"][number];

type ValidatedEvents = {
	readonly prepared: null | PreparedEventChanges;
	readonly chunks: ReadonlyArray<{
		readonly validated: PolicyBatchResult;
		readonly items: ReadonlyArray<PreparedEventChange>;
	}>;
};

const expectedFields = (input: Changes, eventId: EventId) => {
	for (const change of input.events?.changes ?? []) {
		if (change.kind === "delete" && change.eventId === eventId) {
			return change.expected;
		}
		if (change.kind === "update" && change.item.eventId === eventId) {
			return change.item.expected;
		}
	}
	return undefined;
};

const emptyResult: CommitResult = {
	merged: [],
	cleared: [],
	outcomes: [],
	committed: { events: [] },
};

const unrecorded: CommitReceipt<CommitResult> = {
	record: Effect.succeed,
	load: Effect.succeed(null),
};

export class ChangeSets extends Context.Service<ChangeSets>()(
	"@ryot-app/kernel-backend/modules/changes/service/ChangeSets",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const entities = yield* EntitiesService;
			const entityRows = yield* EntitiesRepository;
			const userData = yield* EntityUserDataService;
			const eventRows = yield* EventsRepository;
			const eventMutations = yield* EventMutations;
			const relationships = yield* RelationshipsService;
			const planner = yield* LifecyclePlanner;
			const lifecycle = yield* LifecycleExecution;
			const settingsWriter = yield* PluginUserSettingsWriter;
			const signals = yield* SignalEmissionService;
			const notifications = yield* NotificationsService;
			const folds = yield* FoldMarks;
			const scripts = yield* SandboxRepository;
			const keys = yield* IdempotencyKeys.make;
			const policyContext = yield* Effect.context<
				DatabaseSession | LifecyclePolicies | EntitiesRepository
			>();
			const inTransaction = <A, E>(effect: Effect.Effect<A, E>) =>
				session.transaction(effect).pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			const rejectForeignReferences = Effect.fnUntraced(function* (
				input: ChangeSet,
				userId: UserId,
				pluginId: string,
			) {
				const referenced = changeSetReferences(input);
				const entityOwners = yield* entityRows.getEntityScopes(
					referenced.entities.map(([, entityId]) => entityId),
				);
				const eventOwners = yield* eventRows.getEventOwners(
					referenced.events.map(([, eventId]) => eventId),
				);
				const foreign =
					referenced.entities.find(([, entityId]) => {
						const found = entityOwners.get(entityId);
						return (
							found !== undefined &&
							(found.entitySchemaPluginId !== pluginId ||
								(found.entityUserId !== null && found.entityUserId !== userId))
						);
					}) ??
					referenced.events.find(([, eventId]) => {
						const found = eventOwners.get(eventId);
						return (
							found !== undefined &&
							(found.eventSchemaPluginId !== pluginId || found.userId !== userId)
						);
					});
				if (foreign) {
					const [part, id] = foreign;
					return yield* new ChangeSetRejected({
						part,
						message: `${id} belongs to another plugin or user`,
					});
				}
				return yield* Effect.void;
			});
			const prepareUserChanges = Effect.fn("ChangeSets.prepareUserChanges")(function* (
				input: Changes,
				command: DomainLifecycleCommand,
				userId: UserId,
				pluginRevision: null | ScriptPluginRevision,
				options: CommitOptions,
			) {
				const pluginId = pluginRevision?.id ?? null;
				const independent = options.events?.independent === true;
				const events: NonNullable<Changes["events"]> = input.events ?? { creates: [], changes: [] };
				if (input.entity === undefined && events.expected !== undefined) {
					return yield* rootRequired();
				}
				const prepareEntitySave = (item: NonNullable<Changes["entity"]>, itemIdentity: string) =>
					entities.prepareUserSave({
						userId,
						name: item.name,
						target: item.target,
						properties: item.properties,
						entitySchema: item.entitySchema,
						lifecycle: itemCommand(command, item.itemIdentity ?? itemIdentity),
					});
				const entity =
					input.entity === undefined ? undefined : yield* prepareEntitySave(input.entity, "entity");
				const rootId = entity?.entityId;
				const creates = yield* Effect.forEach(events.creates, (item) =>
					Effect.gen(function* () {
						return {
							kind: "create" as const,
							itemIdentity: item.itemIdentity,
							item: {
								...(item.orderAfter ? { orderAfter: item.orderAfter } : {}),
								properties: item.properties,
								occurredAt: item.occurredAt,
								entityId: yield* referencedEntity(item.entity, rootId),
								eventSchemaSlug: EventSchemaSlug.make(item.eventSchemaSlug),
								sessionEntityId: item.session
									? yield* referencedEntity(item.session, rootId)
									: undefined,
							},
						};
					}),
				);
				const preparedRelations: Array<
					| { readonly kind: "upsert"; readonly prepared: PreparedUserRelationshipCreate }
					| { readonly kind: "delete"; readonly prepared: PreparedUserRelationshipDelete }
				> = [];
				const relationEndpoints: EntityId[] = [];
				const relationshipEndpoints = Effect.fnUntraced(function* (
					relation: NonNullable<NonNullable<Changes["relationships"]>["deletes"]>[number],
				) {
					const sourceEntityId = yield* referencedEntity(relation.source, rootId);
					const targetEntityId = yield* referencedEntity(relation.target, rootId);
					relationEndpoints.push(sourceEntityId, targetEntityId);
					return {
						userId,
						sourceEntityId,
						targetEntityId,
						scope: "user" as const,
						relationshipSchema: relation.relationshipSchema,
					};
				});
				for (const [index, relation] of (input.relationships?.upserts ?? []).entries()) {
					const prepared = yield* relationships.prepareUserCreate(
						{ ...(yield* relationshipEndpoints(relation)), properties: relation.properties },
						itemCommand(command, relation.itemIdentity ?? `relationship:${index}`),
						entity?.created ?? undefined,
						relation.propertiesMode,
					);
					if (prepared) {
						preparedRelations.push({ prepared, kind: "upsert" });
					}
				}
				for (const [index, relation] of (input.relationships?.deletes ?? []).entries()) {
					const prepared = yield* relationships.prepareUserDelete(
						yield* relationshipEndpoints(relation),
						itemCommand(command, relation.itemIdentity ?? `relationship-delete:${index}`),
					);
					if (prepared) {
						preparedRelations.push({ prepared, kind: "delete" });
					}
				}
				const ensures = input.entities?.ensures?.length
					? yield* entities.prepareEnsures(
							userId,
							input.entities.ensures,
							itemCommand(command, "ensures"),
						)
					: undefined;
				const deletesBySchema = new Map<
					string,
					{
						readonly ids: [EntityId, ...EntityId[]];
						readonly entitySchema: NonNullable<Changes["entity"]>["entitySchema"];
					}
				>();
				for (const { entityId, entitySchema } of input.entities?.deletes ?? []) {
					const key = stableStringify(entitySchema);
					const group = deletesBySchema.get(key);
					if (group) {
						group.ids.push(entityId);
					} else {
						deletesBySchema.set(key, { entitySchema, ids: [entityId] });
					}
				}
				const deletes = yield* Effect.forEach(deletesBySchema.values(), ({ ids, entitySchema }) =>
					entities.prepareDeletes(
						ids,
						itemCommand(command, `entity-deletes:${entitySchema.slug}`),
						{ userId, entitySchema },
					),
				);
				const clears = yield* Effect.forEach(
					(input.entities?.clears ?? []).entries(),
					([index, item]) =>
						userData.prepareClear(
							userId,
							item,
							kernelCollectionLifecycleCommand(itemCommand(command, `entity-clear:${index}`)),
						),
				);
				const merges = yield* Effect.forEach(
					(input.entities?.merges ?? []).entries(),
					([index, item]) =>
						userData.prepareMerge(
							userId,
							item,
							kernelCollectionLifecycleCommand(itemCommand(command, `entity-merge:${index}`)),
						),
				);
				const userDataWrites = [...clears, ...merges];
				const updates = yield* Effect.forEach(
					sortBy(input.entities?.updates ?? [], (item) => item.target.entityId),
					(item) => prepareEntitySave(item, `entity-update:${item.target.entityId}`),
				);
				const cascades = deletes.flatMap(entityDeleteEvents);
				if (cascades.some((cascade) => cascade.userId !== userId)) {
					return yield* new DbError({
						message: "An entity delete cascades to another user's events",
					});
				}
				const changes: EventMutation[] = [
					...creates,
					...events.changes,
					...cascades.flatMap((cascade) => cascade.changes.map(prefixed("entity-delete"))),
					...clears.flatMap((prepared, index) =>
						prepared.events.map(prefixed(`entity-clear:${index}`)),
					),
					...merges.flatMap((prepared, index) =>
						prepared.events.map(prefixed(`entity-merge:${index}`)),
					),
				];
				if (new Set(changes.map((item) => item.itemIdentity)).size !== changes.length) {
					return yield* new EventBadRequest({ reason: { code: "mutation-conflict" } });
				}
				const changedIds = changes.flatMap((item) => {
					if (item.kind === "create") {
						return [];
					}
					return [item.kind === "update" ? item.item.eventId : item.eventId];
				});
				if (new Set(changedIds).size !== changedIds.length) {
					return yield* new EventBadRequest({ reason: { code: "mutation-conflict" } });
				}
				const createIndexes = new Map(creates.map((item, index) => [item.itemIdentity, index]));
				const indexOf = (itemIdentity: string) => createIndexes.get(itemIdentity) ?? -1;
				let kept: ReadonlyArray<EventCreateItemOutcome> = [];
				const planEvents = Effect.gen(function* () {
					if (changes.length === 0) {
						return { chunks: [], prepared: null };
					}
					const prepared = yield* eventMutations
						.prepare({
							userId,
							command,
							changes,
							independent,
							verbatimIdentities: options.events?.verbatimIdentities === true,
							proposedEntities:
								entity === undefined ? {} : { [entity.entityId]: userEntitySaveDraft(entity) },
						})
						.pipe(
							Effect.mapError((error) =>
								independent && error._tag !== "DbError"
									? new EventCreateRejected({
											kept: [],
											reason:
												error._tag === "EventCreateItemError"
													? error.reason
													: { code: "invalid-properties" },
										})
									: error,
							),
						);
					kept = prepared.failures.map(({ reason, itemIdentity }) => ({
						reason,
						status: "failed" as const,
						index: indexOf(itemIdentity),
					}));
					const chunks = yield* matchEventPolicies({ userId, command, prepared }).pipe(
						Effect.provideContext(policyContext),
					);
					return { chunks, prepared };
				});
				type PlannedEvents = Effect.Success<typeof planEvents>;
				const validateEvents = (planned: PlannedEvents) =>
					applyEventPolicies(planned.chunks).pipe(
						Effect.provideContext(policyContext),
						Effect.catchTag(
							"AutomationPolicyExecutionError",
							(
								error,
							): Effect.Effect<never, EventCreateRejected | AutomationPolicyExecutionError> =>
								independent
									? Effect.fail(
											new EventCreateRejected({
												kept,
												reason: { runId: error.runId, code: "policy-execution-failed" },
											}),
										)
									: Effect.fail(error),
						),
						Effect.map((chunks): ValidatedEvents => ({ chunks, prepared: planned.prepared })),
					);
				const eventBatches = Effect.fnUntraced(function* (validated: ValidatedEvents) {
					const prepared = validated.prepared;
					if (prepared === null) {
						return [];
					}
					if (!independent) {
						return yield* acceptedEventBatches({ command, prepared, chunks: validated.chunks });
					}
					const batches: Array<{
						validated: PolicyBatchResult;
						prepared: PreparedEventChanges;
						command: DomainLifecycleCommand;
					}> = [];
					for (const chunk of validated.chunks) {
						const policies = policyOutcomes(chunk.validated, indexOf);
						kept = [...kept, ...policies.outcomes];
						const accepted = chunk.items.filter((item) =>
							policies.accepted.has(item.change.itemIdentity),
						);
						if (accepted.length > 0) {
							batches.push({
								command,
								validated: chunk.validated,
								prepared: { ...prepared, items: accepted },
							});
						}
					}
					return batches;
				});
				const sourceWrites = Effect.fnUntraced(function* (
					preparedBatches: Effect.Success<ReturnType<typeof eventBatches>>,
				) {
					const scope = pluginId === null ? null : { pluginId, baselines: events.baselines ?? [] };
					const baselines = scope?.baselines ?? [];
					for (const baseline of baselines) {
						const visible = yield* entityRows.getByIdForUser({
							userId,
							entityId: baseline.entityId,
						});
						if (!visible || visible.entitySchemaPluginId !== pluginId) {
							return yield* new EventBadRequest({ reason: { code: "mutation-conflict" } });
						}
					}
					const references = [
						...new Set([
							...(rootId === undefined ? [] : [rootId]),
							...baselines.map((baseline) => baseline.entityId),
							...preparedBatches.flatMap((batch) =>
								Object.keys(batch.validated.references).map((id) => EntityId.make(id)),
							),
							...relationEndpoints,
							...userDataWrites.flatMap((prepared) => prepared.entityIds),
						]),
					].sort();
					const lockedEntityIds = yield* eventMutations.captureGroups({
						userId,
						entityIds: references,
						batches: preparedBatches,
					});
					const lockedReferences = yield* entityRows.getMutationEntities(lockedEntityIds, true);
					for (const prepared of userDataWrites) {
						yield* prepared.lock;
					}
					if (scope) {
						for (const baseline of baselines) {
							if (!lockedReferences.has(baseline.entityId)) {
								return yield* new EntityStale({
									reason: { code: "entity-stale", entityId: baseline.entityId },
								});
							}
							const current = yield* eventRows.getScopeRevision({
								userId,
								entityId: baseline.entityId,
								eventSchemaPluginId: scope.pluginId,
							});
							if (baseline.revision !== current) {
								return yield* new EntityStale({
									reason: { code: "entity-stale", entityId: baseline.entityId },
								});
							}
						}
					}
					const expected = events.expected;
					if (expected && rootId !== undefined && pluginId !== null) {
						const current = yield* eventRows.listSessionEventIds({
							userId,
							sessionEntityId: rootId,
							eventSchemaPluginId: pluginId,
							eventSchemaSlug: expected.eventSchemaSlug,
						});
						if (stableStringify([...expected.eventIds].sort()) !== stableStringify(current)) {
							return yield* new EntityStale({ reason: { entityId: rootId, code: "entity-stale" } });
						}
					}
					const saved =
						entity === undefined ? undefined : yield* entities.persistPreparedUserSave(entity);
					yield* eventMutations.lockPreparedChanges({ userId, batches: preparedBatches });
					const dispatch: LifecycleDispatchPlan[] = [...(saved?.dispatch ?? [])];
					if (preparedRelations.length > 0) {
						const batch = {
							command,
							identity: ["relationships"],
							resource: "relationship" as const,
						};
						yield* planner.prepareBatch({ ...batch, scopes: [userId] });
						for (const [index, relation] of preparedRelations.entries()) {
							const work =
								relation.kind === "upsert"
									? yield* relationships.persistPreparedUserCreate(relation.prepared, {
											...batch,
											index,
										})
									: yield* relationships.persistPreparedUserDelete(relation.prepared, {
											...batch,
											index,
										});
							dispatch.push(...work.dispatch);
						}
						dispatch.push(...(yield* planner.planBatch(batch)));
					}
					const eventBatch = { command, identity: ["events"], resource: "event" as const };
					yield* planner.prepareBatch({ ...eventBatch, scopes: [userId] });
					const persisted = eventMutations.persistBatches({
						userId,
						batch: eventBatch,
						batches: preparedBatches,
					});
					const written = yield* independent
						? persisted.pipe(
								Effect.mapError((error) =>
									error._tag === "DbError"
										? error
										: new EventCreateRejected({ kept, reason: commitRejection(error) }),
								),
							)
						: persisted.pipe(
								Effect.catchTag("EventReferenceUnavailable", eventReferenceBadRequest),
							);
					dispatch.push(...written.dispatch);
					dispatch.push(...(yield* planner.planBatch(eventBatch)));
					const committed: CommittedChanges = {
						events: written.results,
						...(saved === undefined ? {} : { entityId: saved.entity.id }),
					};
					return { dispatch, committed };
				});
				const write = Effect.fnUntraced(function* (validated: ValidatedEvents) {
					const preparedBatches = yield* eventBatches(validated);
					if (input.settings !== undefined && pluginRevision !== null) {
						yield* settingsWriter.patchWithin({
							userId,
							accountUserId: userId,
							values: input.settings,
							pluginId: pluginRevision.id,
							pluginRevisionId: pluginRevision.revisionId,
						});
					}
					const written =
						entity !== undefined ||
						preparedRelations.length > 0 ||
						preparedBatches.length > 0 ||
						userDataWrites.length > 0
							? yield* sourceWrites(preparedBatches)
							: { dispatch: [], committed: { events: [] } satisfies CommittedChanges };
					const dispatch = [...written.dispatch];
					if (ensures) {
						for (const ensured of yield* entities.persistPreparedEnsures(ensures)) {
							dispatch.push(...ensured.dispatch);
						}
					}
					for (const prepared of deletes) {
						dispatch.push(...(yield* entities.persistPreparedDeletes(prepared)).dispatch);
					}
					const cleared = [];
					for (const prepared of clears) {
						const work = yield* prepared.write;
						cleared.push(work.result);
						dispatch.push(...work.dispatch);
					}
					const merged = [];
					for (const prepared of merges) {
						const work = yield* prepared.write;
						merged.push(work.result);
						dispatch.push(...work.dispatch);
					}
					for (const prepared of updates) {
						dispatch.push(...(yield* entities.persistPreparedUserSave(prepared)).dispatch);
					}
					const outcomes = independent
						? sortedOutcomes([
								...kept,
								...written.committed.events.map(({ eventId, itemIdentity }) => ({
									eventId,
									status: "written" as const,
									index: indexOf(itemIdentity),
								})),
							])
						: [];
					return {
						dispatch,
						result: {
							merged,
							cleared,
							outcomes,
							committed: written.committed,
						} satisfies CommitResult,
					};
				});
				return { write, planEvents, validateEvents, kept: () => kept, createCount: creates.length };
			});
			const apply = Effect.fnUntraced(function* <A>(
				input: Changes,
				command: DomainLifecycleCommand,
				writer: Writer,
				receipt: CommitReceipt<A>,
				options: CommitOptions,
			) {
				const script = writer.kind === "script" ? writer : null;
				const pluginRevision = script?.authority.pluginRevision ?? null;
				const pluginId = pluginRevision?.id ?? null;
				const { precondition } = options;
				const upserted = new Set(
					(input.globalEntities ?? []).map((item) =>
						upsertKey(item.entitySchema.slug, item.externalId),
					),
				);
				const unresolved = (input.globalRelationships ?? [])
					.flatMap(globalReferences)
					.find(
						(reference) =>
							reference.kind === "upserted" &&
							!upserted.has(upsertKey(reference.entitySchema.slug, reference.externalId)),
					);
				if (unresolved) {
					return yield* new ChangeSetRejected({
						part: "globalRelationships",
						message: "A global relationship names an entity the change set does not upsert",
					});
				}
				const providerId = script?.principal.providerId ?? null;
				const user =
					input.userId === null
						? null
						: yield* prepareUserChanges(input, command, input.userId, pluginRevision, options);
				const globalWrites = Effect.gen(function* () {
					const dispatch: LifecycleDispatchPlan[] = [];
					const upsertedIds = new Map<string, EntityId>();
					const globalEntities = input.globalEntities ?? [];
					if (providerId !== null && globalEntities.length > 0) {
						const work = yield* entities.persistPlannedProviderUpserts({
							batch: { command, identity: ["global-entities"] },
							items: globalEntities.map((item) => ({
								providerId,
								name: item.name,
								updateExisting: false,
								scope: "global" as const,
								externalId: item.externalId,
								properties: item.properties,
								entitySchema: item.entitySchema,
								populatedAt: item.populatedAt === null ? null : new Date(item.populatedAt),
								lifecycle: itemCommand(
									command,
									`global-entity:${upsertKey(item.entitySchema.slug, item.externalId)}`,
								),
							})),
						});
						for (const [index, item] of globalEntities.entries()) {
							const result = work.results[index];
							if (result) {
								upsertedIds.set(
									upsertKey(item.entitySchema.slug, item.externalId),
									result.entity.id,
								);
							}
						}
						dispatch.push(...work.dispatch);
					}
					const resolve = (reference: GlobalEntityReference) => {
						if (reference.kind === "existing") {
							return Effect.succeed(reference.entityId);
						}
						const id = upsertedIds.get(
							upsertKey(reference.entitySchema.slug, reference.externalId),
						);
						return id === undefined
							? Effect.die("A resolved global relationship endpoint has no upserted entity")
							: Effect.succeed(id);
					};
					const groups = yield* Effect.forEach(input.globalRelationships ?? [], (group) =>
						Effect.gen(function* () {
							return {
								relationshipSchema: group.relationshipSchema,
								selector:
									group.selector.type === "self"
										? group.selector
										: {
												type: "anchored" as const,
												direction: group.selector.direction,
												anchorEntityId: yield* resolve(group.selector.anchor),
											},
								relationships: yield* Effect.forEach(group.relationships, (relationship) =>
									Effect.gen(function* () {
										return {
											properties: relationship.properties,
											sourceEntityId: yield* resolve(relationship.source),
											targetEntityId: yield* resolve(relationship.target),
										};
									}),
								),
							};
						}),
					);
					if (groups.length > 0) {
						const work = yield* relationships.persistPlannedReconciliation(groups, command, {
							scope: "global",
						});
						dispatch.push(...work.dispatch);
					}
					return dispatch;
				});
				const writeAll = Effect.fnUntraced(function* (validated: null | ValidatedEvents) {
					const written =
						user && validated
							? yield* user.write(validated)
							: { dispatch: [], result: emptyResult };
					if (precondition && written.result.committed.events.length > 0) {
						yield* precondition.written;
					}
					const dispatch = [...written.dispatch];
					dispatch.push(...(yield* globalWrites));
					if (script) {
						for (const signal of input.signals ?? []) {
							const plan = yield* signals.planSignal({
								properties: signal.properties,
								principal: script.authority.signalActor,
								command: itemCommand(command, `signal:${signal.discriminator}`),
								reference: {
									owner: principalOwner(script.principal),
									slug: SignalSchemaSlug.make(signal.schemaSlug),
								},
								...(signal.subjectEntityId === undefined
									? {}
									: { subjectEntityId: signal.subjectEntityId }),
							});
							dispatch.push(toLifecycleDispatchPlan(plan));
						}
						for (const notice of script.authority.notifications) {
							yield* notifications.admitMessageWithin(notice);
						}
					}
					if (input.folds && pluginId !== null) {
						yield* folds.request({
							pluginId,
							entityIds: input.folds.entityIds,
							userId: input.folds.scope === "user" ? input.userId : null,
						});
					}
					return { dispatch, value: yield* receipt.record(written.result) };
				});
				const settled = (
					value: A,
				): { readonly value: A; readonly dispatch: ReadonlyArray<LifecycleDispatchPlan> } => ({
					value,
					dispatch: [],
				});
				const unchecked = Effect.gen(function* () {
					const stored = yield* receipt.load;
					if (stored !== null) {
						return settled(stored);
					}
					return precondition && !(yield* precondition.check)
						? settled(yield* receipt.record(emptyResult))
						: null;
				});
				const transaction = <X, E, R>(work: Effect.Effect<X, E, R>) =>
					eventMutations.transaction(
						reuseLockedWriteChecks(work),
						command.causation.lane === "background" ? "queue" : "inline",
					);
				const commitInTransactions = Effect.gen(function* () {
					const started = yield* transaction(
						Effect.gen(function* () {
							const stopped = yield* unchecked;
							if (stopped !== null) {
								return { committed: stopped, kind: "committed" as const };
							}
							if (user === null) {
								return { kind: "committed" as const, committed: yield* writeAll(null) };
							}
							const planned = yield* user.planEvents;
							if (planned.chunks.every(({ matched }) => matched === null)) {
								return {
									kind: "committed" as const,
									committed: yield* writeAll(yield* user.validateEvents(planned)),
								};
							}
							return { user, planned, kind: "policies" as const };
						}),
					).pipe(
						Effect.catchTags({
							DatabaseSessionStateError: Effect.die,
							LifecyclePersistenceError: Effect.die,
						}),
					);
					if (started.kind === "committed") {
						return started.committed;
					}
					const validated = yield* started.user.validateEvents(started.planned);
					return yield* transaction(
						Effect.gen(function* () {
							return (yield* unchecked) ?? (yield* writeAll(validated));
						}),
					).pipe(
						Effect.catchTags({
							DatabaseSessionStateError: Effect.die,
							LifecyclePersistenceError: Effect.die,
						}),
					);
				});
				const committed = yield* commitInTransactions.pipe(
					Effect.catchTag("EventBadRequest", (error) =>
						Effect.fail(
							options.events?.independent && user
								? new EventCreateRejected({ kept: user.kept(), reason: commitRejection(error) })
								: error,
						),
					),
					Effect.catchTag("EventCreateRejected", (rejection) =>
						inTransaction(
							Effect.gen(function* () {
								const stored = yield* receipt.load;
								return settled(
									stored ??
										(yield* receipt.record({
											...emptyResult,
											outcomes: rejectedOutcomes(rejection, user?.createCount ?? 0),
										})),
								);
							}),
						),
					),
				);
				yield* lifecycle
					.dispatch(committed.dispatch)
					.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
				return committed.value;
			});
			// A field `expected` covers part of an event; a concurrent change outside it leaves the caller's intent valid.
			const retryWhileExpectedHolds = <A, E, R>(input: Changes, work: Effect.Effect<A, E, R>) => {
				const { userId } = input;
				if (userId === null) {
					return work;
				}
				return Effect.retry(work, {
					times: 2,
					while: (error) => {
						if (!(error instanceof EventStale)) {
							return Effect.succeed(false);
						}
						const { eventId } = error.reason;
						const expected = expectedFields(input, eventId);
						if (!expected) {
							return Effect.succeed(false);
						}
						return eventRows
							.getEventSnapshot({ userId, eventId })
							.pipe(
								Effect.map(
									(current) =>
										current !== null && matchesExpectedFields(current.snapshot, expected),
								),
							);
					},
				});
			};
			const commitKernel = <A>(
				input: Changes,
				command: DomainLifecycleCommand,
				receipt: CommitReceipt<A>,
				options: CommitOptions,
			) =>
				Effect.gen(function* () {
					const part = scriptOnlyPart(input);
					if (part !== undefined) {
						return yield* new ChangeSetRejected({
							part,
							message: `${part} requires a script writer`,
						});
					}
					return yield* retryWhileExpectedHolds(
						input,
						shareExecutionAuthority(apply(input, command, { kind: "kernel" }, receipt, options)),
					);
				});
			/** Commits a kernel writer's changes; script authority checks do not apply. */
			const commit = Effect.fn("ChangeSets.commit")(function* (
				input: Changes,
				command: DomainLifecycleCommand,
				options: CommitOptions = {},
			) {
				return yield* commitKernel(input, command, unrecorded, options);
			});
			/**
			 * Commits a kernel writer's changes at most once against the receipt's durable state. A recorded
			 * result ends the commit before preparation runs policies, and again inside the transaction,
			 * where no write precedes it.
			 */
			const commitOnce = Effect.fn("ChangeSets.commitOnce")(function* <A>(
				input: Changes,
				command: DomainLifecycleCommand,
				receipt: CommitReceipt<A>,
				options: CommitOptions = {},
			) {
				return (
					(yield* inTransaction(receipt.load)) ??
					(yield* commitKernel(input, command, receipt, options))
				);
			});
			/** Commits independent event creates once per key, held by the account's idempotency key. */
			const commitEventsKeyed = Effect.fn("ChangeSets.commitEventsKeyed")(function* (
				input: Changes & { readonly userId: UserId },
				command: DomainLifecycleCommand,
				key: string,
				options: CommitOptions & { readonly events: NonNullable<CommitOptions["events"]> },
			) {
				const identity = idempotencyIdentity({
					key,
					request: input,
					userId: input.userId,
					kind: "event-creates",
				});
				return yield* commitOnce(
					input,
					command,
					keyedReceipt(keys, identity, CreateEventsResponse, (result) =>
						toCreateEventsResponse(result.outcomes),
					),
					options,
				);
			});
			/**
			 * Commits a script's change set under its writer's principal (`command.writeContext`), once
			 * against the receipt's durable state. Authority, declared schemas and foreign references are
			 * checked before the change set becomes `Changes` owned by the writing plugin.
			 */
			const commitScript = Effect.fn("ChangeSets.commitScript")(function* <A>(
				input: undefined | ChangeSet,
				command: DomainLifecycleCommand,
				receipt: CommitReceipt<A>,
			) {
				if (input === undefined || isEmptyChangeSet(input)) {
					return yield* inTransaction(
						Effect.gen(function* () {
							return (yield* receipt.load) ?? (yield* receipt.record(emptyResult));
						}),
					);
				}
				const stored = yield* inTransaction(receipt.load);
				if (stored !== null) {
					return stored;
				}
				return yield* shareExecutionAuthority(
					Effect.gen(function* () {
						const principal = command.writeContext;
						if (!principal) {
							return yield* new DbError({
								message: "A change set requires its writer's principal",
							});
						}
						const authorized = authorizeChangeSet(input, principal);
						if (Result.isFailure(authorized)) {
							return yield* authorized.failure;
						}
						const authority = authorized.success;
						const { userId, pluginRevision } = authority;
						if (pluginRevision) {
							const undeclared = undeclaredSchema(
								input,
								yield* scripts.getSchemaScope(pluginRevision.revisionId),
							);
							if (undeclared !== undefined) {
								return yield* new ChangeSetRejected({
									part: "schemas",
									message: `Schema ${undeclared} is not declared by the writing plugin revision`,
								});
							}
							if (userId !== null) {
								yield* rejectForeignReferences(input, userId, pluginRevision.id);
							}
						}
						return yield* apply(
							fromScriptChangeSet(input, userId, pluginRevision?.id ?? null),
							command,
							{ principal, authority, kind: "script" },
							receipt,
							{},
						);
					}),
				);
			});
			return { commit, commitOnce, commitScript, commitEventsKeyed };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
