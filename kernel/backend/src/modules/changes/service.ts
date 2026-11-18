import { BadRequest, DbError, NotFound, ValidationFailed } from "@ryot-app/contract/errors";
import type {
	ChangeSet,
	ChangeSetEntity,
	ChangeSetEntityReference,
	ChangeSetEntityUpdate,
	ChangeSetGlobalEntityReference,
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
import type { EventMutationChange } from "@ryot-app/contract/modules/events/mutations";
import {
	EventBadRequest,
	EventCreateItemError,
	EventNotFound,
	EventStale,
} from "@ryot-app/contract/modules/events/schemas";
import {
	NotificationAdmissionConflictError,
	NotificationAdmissionUnavailableError,
} from "@ryot-app/contract/modules/notifications/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	SignalSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Context, Effect, Layer, Result, Schema } from "effect";

import { ManagedAssetReferenceRejected } from "#lib/domain/managed-asset-writes";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#modules/automations/lifecycle/execution";
import {
	type LifecycleDispatchPlan,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import {
	type PolicyBatchResult,
	runPolicyBatch,
} from "#modules/automations/lifecycle/policy-batch";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { DefinitionReadUnavailable } from "#modules/definitions/read-context";
import { FoldMarks } from "#modules/derived-values/marks";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService, userEntitySaveDraft } from "#modules/entities/service";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import {
	type DomainLifecycleCommand,
	DomainWriteConflict,
	kernelCollectionLifecycleCommand,
	reuseLockedWriteChecks,
} from "#modules/entities/write-context";
import { eventReferenceBadRequest } from "#modules/events/event-references";
import {
	EventMutations,
	eventPolicyItems,
	type PreparedEventChanges,
} from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
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
import {
	principalOwner,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import type { ChangeSetReceipt } from "#modules/scripts/executions/script-changes";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";

import { authorizeChangeSet, ChangeSetRejected, undeclaredSchema } from "./authority";

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
export const isEmptyChangeSet = (changes: ChangeSet) =>
	parts(changes).every((part) => part === undefined || (Array.isArray(part) && part.length === 0));

const itemCommand = (command: DomainLifecycleCommand, itemIdentity: string) => ({
	...command,
	itemIdentity: `${command.itemIdentity}:${itemIdentity}`,
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

const globalReferences = (group: NonNullable<ChangeSet["globalRelationships"]>[number]) => [
	...(group.selector.type === "anchored" ? [group.selector.anchor] : []),
	...group.relationships.flatMap(({ source, target }) => [source, target]),
];

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
			const policyContext = yield* Effect.context<
				DatabaseSession | LifecyclePlanner | EntitiesRepository | LifecycleExecution
			>();
			const prepareUserChanges = Effect.fn("ChangeSets.prepareUserChanges")(function* (
				input: ChangeSet,
				command: DomainLifecycleCommand,
				userId: UserId,
				pluginRevision: ScriptPluginRevision,
			) {
				const pluginId = pluginRevision.id;
				const owner = definitionOwner(pluginId);
				const events: NonNullable<ChangeSet["events"]> = input.events ?? {
					creates: [],
					changes: [],
				};
				if (input.entity === undefined && events.expected !== undefined) {
					return yield* rootRequired();
				}
				const prepareEntitySave = (
					item: ChangeSetEntity | ChangeSetEntityUpdate,
					itemIdentity: string,
				) =>
					entities.prepareUserSave({
						userId,
						name: item.name,
						target: item.target,
						properties: item.properties,
						lifecycle: itemCommand(command, item.itemIdentity ?? itemIdentity),
						entitySchema: { owner, slug: EntitySchemaSlug.make(item.entitySchemaSlug) },
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
				const changes: EventMutationChange[] = [...creates, ...events.changes];
				if (new Set(changes.map((item) => item.itemIdentity)).size !== changes.length) {
					return yield* new EventBadRequest({ reason: { code: "mutation-conflict" } });
				}
				const changedIds = changes.flatMap((item) =>
					item.kind === "create" ? [] : [item.kind === "delete" ? item.eventId : item.item.eventId],
				);
				if (new Set(changedIds).size !== changedIds.length) {
					return yield* new EventBadRequest({ reason: { code: "mutation-conflict" } });
				}
				const preparedRelations: Array<
					| { readonly kind: "upsert"; readonly prepared: PreparedUserRelationshipCreate }
					| { readonly kind: "delete"; readonly prepared: PreparedUserRelationshipDelete }
				> = [];
				const relationEndpoints: EntityId[] = [];
				const relationshipEndpoints = Effect.fnUntraced(function* (relation: {
					readonly relationshipSchemaSlug: string;
					readonly source: ChangeSetEntityReference;
					readonly target: ChangeSetEntityReference;
				}) {
					const sourceEntityId = yield* referencedEntity(relation.source, rootId);
					const targetEntityId = yield* referencedEntity(relation.target, rootId);
					relationEndpoints.push(sourceEntityId, targetEntityId);
					return {
						userId,
						sourceEntityId,
						targetEntityId,
						scope: "user" as const,
						relationshipSchema: {
							owner,
							slug: RelationshipSchemaSlug.make(relation.relationshipSchemaSlug),
						},
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
				const preparedBatches: Array<{
					validated: PolicyBatchResult;
					prepared: PreparedEventChanges;
					command: DomainLifecycleCommand;
				}> = [];
				for (let offset = 0; offset < changes.length; offset += 50) {
					const batchCommand = itemCommand(command, `events:${offset}`);
					const prepared = yield* session
						.transaction(
							eventMutations.prepare({
								userId,
								command,
								positionOffset: offset,
								changes: changes.slice(offset, offset + 50),
								proposedEntities:
									entity === undefined ? {} : { [entity.entityId]: userEntitySaveDraft(entity) },
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
					const validated = yield* runPolicyBatch({
						userId,
						resource: "event",
						command: batchCommand,
						references: prepared.references,
						items: yield* eventPolicyItems(prepared),
						propertiesSchemas: prepared.propertiesSchemas,
					}).pipe(
						Effect.provideContext(policyContext),
						Effect.catchTag(
							"PolicyBatchBlocked",
							() => new EventBadRequest({ reason: { code: "automation-limit" } }),
						),
					);
					const rejection = validated.items.find((item) => item.rejected !== null)?.rejected;
					if (rejection) {
						return yield* new EventBadRequest({
							reason: { message: rejection, code: "policy-rejected" },
						});
					}
					const invalid = validated.items.find((item) => item.error !== null);
					if (invalid?.error) {
						return yield* new EventBadRequest({
							reason: {
								code:
									invalid.error.code === "reference-not-found"
										? "invalid-policy-transform"
										: invalid.error.code,
							},
						});
					}
					preparedBatches.push({ prepared, validated, command: batchCommand });
				}
				const ensures = input.entities?.ensures?.length
					? yield* entities.prepareEnsures(
							userId,
							input.entities.ensures.map(({ entitySchemaSlug, ...item }) => ({
								...item,
								entitySchema: { owner, slug: EntitySchemaSlug.make(entitySchemaSlug) },
							})),
							itemCommand(command, "ensures"),
						)
					: undefined;
				const deletesBySchema = new Map<string, [EntityId, ...EntityId[]]>();
				for (const { entityId, entitySchemaSlug } of input.entities?.deletes ?? []) {
					const ids = deletesBySchema.get(entitySchemaSlug);
					if (ids) {
						ids.push(entityId);
					} else {
						deletesBySchema.set(entitySchemaSlug, [entityId]);
					}
				}
				const deletes = yield* Effect.forEach(deletesBySchema, ([entitySchemaSlug, ids]) =>
					entities.prepareDeletes(ids, itemCommand(command, `entity-deletes:${entitySchemaSlug}`), {
						userId,
						entitySchema: { owner, slug: EntitySchemaSlug.make(entitySchemaSlug) },
					}),
				);
				const clears = yield* Effect.forEach(
					(input.entities?.clears ?? []).entries(),
					([index, item]) =>
						userData.prepareClearForCommand(
							userId,
							{
								entityId: item.entityId,
								entitySchemaSlug: EntitySchemaSlug.make(item.entitySchemaSlug),
							},
							kernelCollectionLifecycleCommand(itemCommand(command, `entity-clear:${index}`)),
						),
				);
				const merges = yield* Effect.forEach(
					(input.entities?.merges ?? []).entries(),
					([index, item]) =>
						userData.prepareMergeForCommand(
							userId,
							{
								mergeFrom: item.mergeFrom,
								mergeInto: item.mergeInto,
								entitySchemaSlug: EntitySchemaSlug.make(item.entitySchemaSlug),
							},
							kernelCollectionLifecycleCommand(itemCommand(command, `entity-merge:${index}`)),
						),
				);
				const updates = yield* Effect.forEach(
					sortBy(input.entities?.updates ?? [], (item) => item.target.entityId),
					(item) => prepareEntitySave(item, `entity-update:${item.target.entityId}`),
				);
				const sourceWrites = Effect.gen(function* () {
					const baselines = events.baselines ?? [];
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
						]),
					].sort();
					const lockedEntityIds = yield* eventMutations.captureGroups({
						userId,
						entityIds: references,
						batches: preparedBatches,
					});
					const lockedReferences = yield* entityRows.getMutationEntities(lockedEntityIds, true);
					for (const baseline of baselines) {
						if (!lockedReferences.has(baseline.entityId)) {
							return yield* new EntityStale({
								reason: { code: "entity-stale", entityId: baseline.entityId },
							});
						}
						const current = yield* eventRows.getScopeRevision({
							userId,
							entityId: baseline.entityId,
							eventSchemaPluginId: pluginId,
						});
						if (baseline.revision !== current) {
							return yield* new EntityStale({
								reason: { code: "entity-stale", entityId: baseline.entityId },
							});
						}
					}
					const expected = events.expected;
					if (expected && rootId !== undefined) {
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
					const written = [];
					const eventBatch = { command, identity: ["events"], resource: "event" as const };
					yield* planner.prepareBatch({ ...eventBatch, scopes: [userId] });
					let eventOffset = 0;
					for (const prepared of preparedBatches) {
						const work = yield* eventMutations
							.persist({
								userId,
								...prepared,
								sealBatch: false,
								batch: eventBatch,
								batchIndexOffset: eventOffset,
							})
							.pipe(Effect.catchTag("EventReferenceUnavailable", eventReferenceBadRequest));
						eventOffset += prepared.prepared.items.length;
						written.push(...work.results);
						dispatch.push(...work.dispatch);
					}
					dispatch.push(...(yield* planner.planBatch(eventBatch)));
					const result: CommittedChanges = {
						events: written,
						...(saved === undefined ? {} : { entityId: saved.entity.id }),
					};
					return { result, dispatch };
				});
				const hasSourceWrites =
					entity !== undefined || preparedRelations.length > 0 || preparedBatches.length > 0;
				const write = Effect.gen(function* () {
					if (input.settings !== undefined) {
						yield* settingsWriter.patchWithin({
							userId,
							pluginId,
							accountUserId: userId,
							values: input.settings,
							pluginRevisionId: pluginRevision.revisionId,
						});
					}
					const written = hasSourceWrites
						? yield* sourceWrites
						: { dispatch: [], result: { events: [] } satisfies CommittedChanges };
					const dispatch = [...written.dispatch];
					if (ensures) {
						for (const ensured of yield* entities.persistPreparedEnsures(ensures)) {
							dispatch.push(...ensured.dispatch);
						}
					}
					for (const prepared of deletes) {
						dispatch.push(...(yield* entities.persistPreparedDeletes(prepared)).dispatch);
					}
					for (const prepared of clears) {
						dispatch.push(...(yield* userData.persistPreparedClear(prepared)).dispatch);
					}
					for (const prepared of merges) {
						dispatch.push(...(yield* userData.persistPreparedMerge(prepared)).dispatch);
					}
					for (const prepared of updates) {
						dispatch.push(...(yield* entities.persistPreparedUserSave(prepared)).dispatch);
					}
					return { dispatch, result: written.result };
				});
				return { write };
			});
			const apply = Effect.fnUntraced(function* <A>(
				input: ChangeSet,
				command: DomainLifecycleCommand,
				receipt: ChangeSetReceipt<A>,
			) {
				const principal = command.writeContext;
				if (!principal) {
					return yield* new DbError({ message: "A change set requires its writer's principal" });
				}
				const authorized = authorizeChangeSet(input, principal);
				if (Result.isFailure(authorized)) {
					return yield* authorized.failure;
				}
				const { signalActor, pluginRevision, notifications: notices } = authorized.success;
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
				}
				const { userId } = authorized.success;
				const pluginId = pluginRevision?.id ?? null;
				const owner = definitionOwner(pluginId);
				const upserted = new Set(
					(input.globalEntities ?? []).map((item) =>
						upsertKey(item.entitySchemaSlug, item.externalId),
					),
				);
				const unresolved = (input.globalRelationships ?? [])
					.flatMap(globalReferences)
					.find(
						(reference) =>
							reference.kind === "upserted" &&
							!upserted.has(upsertKey(reference.entitySchemaSlug, reference.externalId)),
					);
				if (unresolved) {
					return yield* new ChangeSetRejected({
						part: "globalRelationships",
						message: "A global relationship names an entity the change set does not upsert",
					});
				}
				const providerId = principal.providerId;
				const user =
					userId === null || pluginRevision === null
						? null
						: yield* prepareUserChanges(input, command, userId, pluginRevision);
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
								populatedAt: item.populatedAt === null ? null : new Date(item.populatedAt),
								entitySchema: { owner, slug: EntitySchemaSlug.make(item.entitySchemaSlug) },
								lifecycle: itemCommand(
									command,
									`global-entity:${upsertKey(item.entitySchemaSlug, item.externalId)}`,
								),
							})),
						});
						for (const [index, item] of globalEntities.entries()) {
							const result = work.results[index];
							if (result) {
								upsertedIds.set(
									upsertKey(item.entitySchemaSlug, item.externalId),
									result.entity.id,
								);
							}
						}
						dispatch.push(...work.dispatch);
					}
					const resolve = (reference: ChangeSetGlobalEntityReference) => {
						if (reference.kind === "existing") {
							return Effect.succeed(reference.entityId);
						}
						const id = upsertedIds.get(upsertKey(reference.entitySchemaSlug, reference.externalId));
						return id === undefined
							? Effect.die("A resolved global relationship endpoint has no upserted entity")
							: Effect.succeed(id);
					};
					const groups = yield* Effect.forEach(input.globalRelationships ?? [], (group) =>
						Effect.gen(function* () {
							return {
								relationshipSchema: {
									owner,
									slug: RelationshipSchemaSlug.make(group.relationshipSchemaSlug),
								},
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
				const committed = yield* eventMutations
					.transaction(
						reuseLockedWriteChecks(
							Effect.gen(function* () {
								const stored = yield* receipt.load;
								if (stored !== null) {
									return { dispatch: [], value: stored };
								}
								const written = user
									? yield* user.write
									: { dispatch: [], result: { events: [] } satisfies CommittedChanges };
								const dispatch = [...written.dispatch];
								dispatch.push(...(yield* globalWrites));
								for (const signal of input.signals ?? []) {
									const plan = yield* signals.planSignal({
										principal: signalActor,
										properties: signal.properties,
										command: itemCommand(command, `signal:${signal.discriminator}`),
										reference: {
											owner: principalOwner(principal),
											slug: SignalSchemaSlug.make(signal.schemaSlug),
										},
										...(signal.subjectEntityId === undefined
											? {}
											: { subjectEntityId: signal.subjectEntityId }),
									});
									dispatch.push(toLifecycleDispatchPlan(plan));
								}
								for (const notice of notices) {
									yield* notifications.admitMessageWithin(notice);
								}
								if (input.folds && pluginId !== null) {
									yield* folds.request({
										pluginId,
										entityIds: input.folds.entityIds,
										userId: input.folds.scope === "user" ? userId : null,
									});
								}
								return { dispatch, value: yield* receipt.record(written.result) };
							}),
						),
					)
					.pipe(
						Effect.catchTags({
							DatabaseSessionStateError: Effect.die,
							LifecyclePersistenceError: Effect.die,
						}),
					);
				yield* lifecycle
					.dispatch(committed.dispatch)
					.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
				return committed.value;
			});
			const commit = Effect.fn("ChangeSets.commit")(function* (
				input: ChangeSet,
				command: DomainLifecycleCommand,
			) {
				return yield* apply(input, command, { record: Effect.succeed, load: Effect.succeed(null) });
			});
			const inTransaction = <A, E>(effect: Effect.Effect<A, E>) =>
				session.transaction(effect).pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			/**
			 * Commits at most once against the receipt's durable state. A recorded result ends the commit
			 * before preparation runs policies, and again inside the transaction, where no write precedes it.
			 */
			const commitOnce = Effect.fn("ChangeSets.commitOnce")(function* <A>(
				input: undefined | ChangeSet,
				command: DomainLifecycleCommand,
				receipt: ChangeSetReceipt<A>,
			) {
				if (input === undefined || isEmptyChangeSet(input)) {
					return yield* inTransaction(
						Effect.gen(function* () {
							return (yield* receipt.load) ?? (yield* receipt.record({ events: [] }));
						}),
					);
				}
				return (yield* inTransaction(receipt.load)) ?? (yield* apply(input, command, receipt));
			});
			return { commit, commitOnce };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
