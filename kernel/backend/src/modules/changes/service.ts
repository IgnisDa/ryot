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
	type ListedEntity,
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
	applyPolicyChunks,
	AutomationPolicyExecutionError,
	type LifecyclePolicies,
	type MatchedPolicyChunks,
	type PolicyBatchResult,
} from "#modules/automations/lifecycle/policies";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { DefinitionReadUnavailable } from "#modules/definitions/read-context";
import { FoldMarks } from "#modules/derived-values/marks";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	acceptEntityPolicies,
	applyEntityPolicies,
	EntitiesService,
	entityDeleteEvents,
	type EntityPolicyAcceptance,
	entityPolicyItems,
	entitySaveDraft,
	matchEntityPolicies,
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
import {
	acceptRelationshipPolicies,
	applyRelationshipPolicies,
	matchRelationshipPolicies,
	preparedRelationshipEntityIds,
	type PreparedUserRelationship,
	type UserRelationshipMode,
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

/**
 * `verbatimIdentities` keeps each entity, event or relationship item's own identity rather than
 * prefixing it with the command's.
 */
export type CommitOptions = {
	readonly precondition?: CommitPrecondition;
	readonly entities?: { readonly verbatimIdentities: true };
	readonly relationships?: { readonly verbatimIdentities: true };
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
			["events.expected", changes.events?.expected !== undefined],
			["events.baselines", changes.events?.baselines !== undefined],
		] as const
	).find(([, present]) => present)?.[0];

/** A part only a change set with a user writes. */
const userOnlyPart = (changes: Changes) =>
	(
		[
			["entity", changes.entity !== undefined],
			["events", changes.events !== undefined],
			["relationships", changes.relationships !== undefined],
			["entities.ensures", (changes.entities?.ensures?.length ?? 0) > 0],
			["entities.clears", (changes.entities?.clears?.length ?? 0) > 0],
			["entities.merges", (changes.entities?.merges?.length ?? 0) > 0],
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

type EventBatch = {
	readonly validated: PolicyBatchResult;
	readonly prepared: PreparedEventChanges;
	readonly command: DomainLifecycleCommand;
};

/** One user's event changes: the change set's own, or an entity delete's cascade to another user. */
type EventGroup = {
	readonly main: boolean;
	readonly userId: UserId;
	readonly command: DomainLifecycleCommand;
	readonly changes: ReadonlyArray<EventMutation>;
};

type ValidatedPolicies = {
	readonly entities: EntityPolicyAcceptance;
	readonly relationships: Effect.Success<ReturnType<typeof applyRelationshipPolicies>>;
	readonly events: ReadonlyArray<{
		readonly group: EventGroup;
		readonly prepared: PreparedEventChanges;
		readonly chunks: ReadonlyArray<{
			readonly validated: PolicyBatchResult;
			readonly items: ReadonlyArray<PreparedEventChange>;
		}>;
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
	deleted: [],
	entities: [],
	outcomes: [],
	relationships: [],
	committed: { events: [] },
};

const unrecorded: CommitReceipt<CommitResult> = {
	record: Effect.succeed,
	load: Effect.succeed(null),
};

/** The result a receipt recorded, or the empty result a false precondition records; null commits. */
const settledByReceipt = <A>(receipt: CommitReceipt<A>, precondition?: CommitPrecondition) =>
	Effect.gen(function* () {
		const stored = yield* receipt.load;
		if (stored !== null) {
			return stored;
		}
		return precondition && !(yield* precondition.check) ? yield* receipt.record(emptyResult) : null;
	});

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
				const mismatched = referenced.entities.find(([, entityId, entitySchemaSlug]) => {
					const found = entityOwners.get(entityId);
					return (
						found !== undefined &&
						entitySchemaSlug !== undefined &&
						found.entitySchemaSlug !== entitySchemaSlug
					);
				});
				if (mismatched) {
					const [part, id, entitySchemaSlug] = mismatched;
					return yield* new ChangeSetRejected({
						part,
						message: `${id} is not a ${entitySchemaSlug} entity`,
					});
				}
				return yield* Effect.void;
			});
			const prepareChanges = Effect.fn("ChangeSets.prepareChanges")(function* (
				input: Changes,
				command: DomainLifecycleCommand,
				pluginRevision: null | ScriptPluginRevision,
				options: CommitOptions,
			) {
				const { userId } = input;
				const pluginId = pluginRevision?.id ?? null;
				const independent = options.events?.independent === true;
				const events: NonNullable<Changes["events"]> = input.events ?? { creates: [], changes: [] };
				const userPart = userId === null ? userOnlyPart(input) : undefined;
				if (userPart !== undefined) {
					return yield* new ChangeSetRejected({
						part: userPart,
						message: `${userPart} requires a user`,
					});
				}
				const requireUser = Effect.suspend(() =>
					userId === null
						? Effect.die("A user part reached a change set without a user")
						: Effect.succeed(userId),
				);
				if (input.entity === undefined && events.expected !== undefined) {
					return yield* rootRequired();
				}
				const identityCommand = (
					verbatim: undefined | { readonly verbatimIdentities: true },
					itemIdentity: string,
				) => (verbatim ? { ...command, itemIdentity } : itemCommand(command, itemIdentity));
				const prepareEntitySave = (
					item: {
						readonly name: string;
						readonly properties: unknown;
						readonly populatedAt?: null | string;
						readonly entitySchema: NonNullable<Changes["entity"]>["entitySchema"];
					},
					itemIdentity: string,
					target: Parameters<typeof entities.prepareSave>[0]["target"],
				) =>
					entities
						.prepareSave({
							target,
							name: item.name,
							scopeUserId: userId,
							properties: item.properties,
							entitySchema: item.entitySchema,
							lifecycle: identityCommand(options.entities, itemIdentity),
							...(item.populatedAt === undefined ? {} : { populatedAt: item.populatedAt }),
						})
						.pipe(Effect.map((prepared) => ({ prepared, itemIdentity })));
				const entity =
					input.entity === undefined
						? undefined
						: yield* prepareEntitySave(
								input.entity,
								input.entity.itemIdentity ?? "entity",
								input.entity.target,
							);
				const rootId = entity?.prepared.entityId;
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
				const relationshipInput = Effect.fnUntraced(function* (
					relation: NonNullable<NonNullable<Changes["relationships"]>["deletes"]>[number],
				) {
					return {
						scope: "user" as const,
						userId: yield* requireUser,
						relationshipSchema: relation.relationshipSchema,
						sourceEntityId: yield* referencedEntity(relation.source, rootId),
						targetEntityId: yield* referencedEntity(relation.target, rootId),
					};
				});
				const relationshipParts = input.relationships ?? {};
				const preparedRelations: Array<{
					readonly itemIdentity: string;
					readonly prepared: null | PreparedUserRelationship;
				}> = [];
				const prepareRelationshipWrite = Effect.fnUntraced(function* (
					relation: NonNullable<(typeof relationshipParts)["updates"]>[number],
					mode: UserRelationshipMode,
					itemIdentity: string,
				) {
					preparedRelations.push({
						itemIdentity,
						prepared: yield* relationships.prepareUserWrite(
							{ ...(yield* relationshipInput(relation)), properties: relation.properties },
							identityCommand(options.relationships, itemIdentity),
							mode,
							entity?.prepared.created ?? undefined,
						),
					});
				});
				for (const [index, relation] of (relationshipParts.upserts ?? []).entries()) {
					yield* prepareRelationshipWrite(
						relation,
						relation.propertiesMode === "merge" ? "merge" : "upsert",
						relation.itemIdentity ?? `relationship:${index}`,
					);
				}
				for (const [index, relation] of (relationshipParts.updates ?? []).entries()) {
					yield* prepareRelationshipWrite(
						relation,
						"update",
						relation.itemIdentity ?? `relationship-update:${index}`,
					);
				}
				for (const [index, relation] of (relationshipParts.ensures ?? []).entries()) {
					yield* prepareRelationshipWrite(
						relation,
						"ensure",
						relation.itemIdentity ?? `relationship-ensure:${index}`,
					);
				}
				for (const [index, relation] of (relationshipParts.deletes ?? []).entries()) {
					const itemIdentity = relation.itemIdentity ?? `relationship-delete:${index}`;
					preparedRelations.push({
						itemIdentity,
						prepared: yield* relationships.prepareUserDelete(
							yield* relationshipInput(relation),
							identityCommand(options.relationships, itemIdentity),
						),
					});
				}
				for (const [index, relation] of (relationshipParts.deletesById ?? []).entries()) {
					const itemIdentity = relation.itemIdentity ?? `relationship-delete-by-id:${index}`;
					preparedRelations.push({
						itemIdentity,
						prepared: yield* relationships.prepareUserDeleteById(
							yield* requireUser,
							relation.relationshipId,
							identityCommand(options.relationships, itemIdentity),
						),
					});
				}
				const relationEndpoints = preparedRelations.flatMap(({ prepared }) =>
					prepared === null ? [] : preparedRelationshipEntityIds(prepared),
				);
				const ensures = input.entities?.ensures?.length
					? yield* entities.prepareEnsures(
							yield* requireUser,
							input.entities.ensures,
							itemCommand(command, "ensures"),
						)
					: undefined;
				const deletesBySchema = new Map<
					string,
					{
						readonly preserveHistory: boolean;
						readonly ids: [EntityId, ...EntityId[]];
						readonly entitySchema: NonNullable<Changes["entity"]>["entitySchema"];
					}
				>();
				for (const { entityId, entitySchema, preserveHistory } of input.entities?.deletes ?? []) {
					const key = stableStringify([entitySchema, preserveHistory === true]);
					const group = deletesBySchema.get(key);
					if (group) {
						group.ids.push(entityId);
					} else {
						deletesBySchema.set(key, {
							entitySchema,
							ids: [entityId],
							preserveHistory: preserveHistory === true,
						});
					}
				}
				const deletes = yield* Effect.forEach(
					deletesBySchema.entries(),
					([key, { ids, entitySchema, preserveHistory }]) =>
						entities.prepareDeletes(ids, itemCommand(command, `entity-deletes:${key}`), {
							entitySchema,
							preserveHistory,
							scopeUserId: userId,
						}),
				);
				const clears = yield* Effect.forEach(
					(input.entities?.clears ?? []).entries(),
					([index, item]) =>
						Effect.flatMap(requireUser, (owner) =>
							userData.prepareClear(
								owner,
								item,
								kernelCollectionLifecycleCommand(itemCommand(command, `entity-clear:${index}`)),
							),
						),
				);
				const merges = yield* Effect.forEach(
					(input.entities?.merges ?? []).entries(),
					([index, item]) =>
						Effect.flatMap(requireUser, (owner) =>
							userData.prepareMerge(
								owner,
								item,
								kernelCollectionLifecycleCommand(itemCommand(command, `entity-merge:${index}`)),
							),
						),
				);
				const userDataWrites = [...clears, ...merges];
				const saves = [
					...(yield* Effect.forEach((input.entities?.creates ?? []).entries(), ([index, item]) =>
						prepareEntitySave(item, item.itemIdentity ?? `entity-create:${index}`, {
							kind: "create",
							...(item.provider ? { provider: item.provider } : {}),
							...(item.externalId === undefined ? {} : { externalId: item.externalId }),
						}),
					)),
					...(yield* Effect.forEach(
						sortBy(input.entities?.updates ?? [], (item) => item.target.entityId),
						(item) =>
							prepareEntitySave(
								item,
								item.itemIdentity ?? `entity-update:${item.target.entityId}`,
								item.target,
							),
					)),
				];
				const cascades = deletes.flatMap(entityDeleteEvents);
				const changes: EventMutation[] = [
					...creates,
					...events.changes,
					...cascades.flatMap((cascade) =>
						cascade.userId === userId ? cascade.changes.map(prefixed("entity-delete")) : [],
					),
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
				const eventGroups: ReadonlyArray<EventGroup> = [
					...(changes.length === 0
						? []
						: [{ changes, command, main: true, userId: yield* requireUser }]),
					...cascades.flatMap((cascade) =>
						cascade.userId === userId
							? []
							: [
									{
										main: false,
										userId: cascade.userId,
										command: cascade.command,
										changes: cascade.changes.map(prefixed("entity-delete")),
									},
								],
					),
				];
				const entityTokens = [
					...(entity === undefined ? [] : [entity.prepared]),
					...saves.map(({ prepared }) => prepared),
					...(ensures === undefined ? [] : [ensures]),
					...deletes,
				];
				const createIndexes = new Map(creates.map((item, index) => [item.itemIdentity, index]));
				const indexOf = (itemIdentity: string) => createIndexes.get(itemIdentity) ?? -1;
				let kept: ReadonlyArray<EventCreateItemOutcome> = [];
				const relationshipTokens = [
					...preparedRelations.flatMap(({ prepared }) => (prepared === null ? [] : [prepared])),
					...userDataWrites.flatMap((prepared) => prepared.relationships),
				];
				const rootDraft = entity === undefined ? null : yield* entitySaveDraft(entity.prepared);
				const entityBatch = { command, identity: ["entities"] };
				const planEvents = Effect.forEach(eventGroups, (group) =>
					Effect.gen(function* () {
						const prepared = yield* eventMutations
							.prepare({
								userId: group.userId,
								command: group.command,
								changes: group.changes,
								...(group.main
									? {
											independent,
											verbatimIdentities: options.events?.verbatimIdentities === true,
											proposedEntities:
												entity === undefined || rootDraft === null
													? {}
													: { [entity.prepared.entityId]: rootDraft },
										}
									: {}),
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
						if (group.main) {
							kept = prepared.failures.map(({ reason, itemIdentity }) => ({
								reason,
								status: "failed" as const,
								index: indexOf(itemIdentity),
							}));
						}
						const chunks = yield* matchEventPolicies({
							prepared,
							userId: group.userId,
							command: group.command,
						}).pipe(Effect.provideContext(policyContext));
						return { group, chunks, prepared };
					}),
				);
				const planPolicies = Effect.gen(function* () {
					return {
						events: yield* planEvents,
						entities: yield* matchEntityPolicies({
							userId,
							command,
							items: entityTokens.flatMap(entityPolicyItems),
						}).pipe(Effect.provideContext(policyContext)),
						relationships:
							relationshipTokens.length === 0
								? []
								: yield* matchRelationshipPolicies({
										command,
										userId: yield* requireUser,
										prepared: relationshipTokens,
									}).pipe(Effect.provideContext(policyContext)),
					};
				});
				type PlannedPolicies = Effect.Success<typeof planPolicies>;
				const validatePolicies = Effect.fnUntraced(function* (planned: PlannedPolicies) {
					const acceptEntity = acceptEntityPolicies(
						yield* applyEntityPolicies(planned.entities).pipe(Effect.provideContext(policyContext)),
					);
					const acceptedRoot =
						entity === undefined ? null : yield* entitySaveDraft(entity.prepared, acceptEntity);
					const withAcceptedRoot = <T>(chunk: MatchedPolicyChunks<T>[number]) => {
						const { references } = chunk.policyBatch;
						return rootId === undefined ||
							acceptedRoot === null ||
							!Object.hasOwn(references, rootId)
							? chunk
							: {
									...chunk,
									policyBatch: {
										...chunk.policyBatch,
										references: { ...references, [rootId]: acceptedRoot },
									},
								};
					};
					const eventPolicies = yield* Effect.forEach(planned.events, (group) =>
						applyPolicyChunks(group.chunks.map(withAcceptedRoot)).pipe(
							Effect.map((chunks) => ({ ...group, chunks })),
							Effect.provideContext(policyContext),
						),
					).pipe(
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
					);
					return {
						events: eventPolicies,
						entities: acceptEntity,
						relationships: yield* applyRelationshipPolicies(planned.relationships).pipe(
							Effect.provideContext(policyContext),
						),
					} satisfies ValidatedPolicies;
				});
				const eventBatches = Effect.fnUntraced(function* (validated: ValidatedPolicies) {
					return yield* Effect.forEach(validated.events, ({ group, chunks, prepared }) =>
						Effect.gen(function* () {
							if (!group.main || !independent) {
								return {
									group,
									batches: yield* acceptedEventBatches({
										chunks,
										prepared,
										command: group.command,
									}),
								};
							}
							const batches: Array<EventBatch> = [];
							for (const chunk of chunks) {
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
							return { group, batches };
						}),
					);
				});
				const sourceWrites = Effect.fnUntraced(function* (
					groups: Effect.Success<ReturnType<typeof eventBatches>>,
					accept: ReturnType<typeof acceptRelationshipPolicies>,
					acceptEntity: EntityPolicyAcceptance,
				) {
					const main = groups.find(({ group }) => group.main)?.batches ?? [];
					const dispatch: LifecycleDispatchPlan[] = [];
					const relationshipResults: Array<CommitResult["relationships"][number]> = [];
					let saved: undefined | ListedEntity;
					if (userId !== null) {
						const scope =
							pluginId === null ? null : { pluginId, baselines: events.baselines ?? [] };
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
								...main.flatMap((batch) =>
									Object.keys(batch.validated.references).map((id) => EntityId.make(id)),
								),
								...relationEndpoints,
								...userDataWrites.flatMap((prepared) => prepared.entityIds),
							]),
						].sort();
						const lockedEntityIds = yield* eventMutations.captureGroups({
							userId,
							batches: main,
							entityIds: references,
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
								return yield* new EntityStale({
									reason: { entityId: rootId, code: "entity-stale" },
								});
							}
						}
						if (entity !== undefined) {
							const work = yield* entities.persistPreparedSaves(
								[entity.prepared],
								acceptEntity,
								entityBatch,
								0,
							);
							[saved] = work.entities;
							dispatch.push(...work.dispatch);
						}
						yield* eventMutations.lockPreparedChanges({ userId, batches: main });
						if (preparedRelations.length > 0) {
							const batch = {
								command,
								identity: ["relationships"],
								resource: "relationship" as const,
							};
							yield* planner.prepareBatch({ ...batch, scopes: [userId] });
							for (const [index, { prepared, itemIdentity }] of preparedRelations.entries()) {
								if (prepared === null) {
									relationshipResults.push({ itemIdentity, operation: "noop", relationship: null });
									continue;
								}
								const work = yield* relationships.persistPrepared(yield* accept(prepared), {
									...batch,
									index,
								});
								dispatch.push(...work.dispatch);
								relationshipResults.push({ ...work.result, itemIdentity });
							}
							dispatch.push(...(yield* planner.planBatch(batch)));
						}
					}
					for (const { group, batches } of groups) {
						if (!group.main) {
							yield* eventMutations.lockPreparedChanges({ batches, userId: group.userId });
						}
					}
					const eventBatch = { command, identity: ["events"], resource: "event" as const };
					yield* planner.prepareBatch({
						...eventBatch,
						scopes: [
							...new Set([
								...(userId === null ? [] : [userId]),
								...groups.map(({ group }) => group.userId),
							]),
						],
					});
					const persisted = Effect.gen(function* () {
						const results: Array<CommittedChanges["events"][number]> = [];
						const persistedDispatch: LifecycleDispatchPlan[] = [];
						let batchIndexOffset = 0;
						for (const { group, batches } of groups) {
							const work = yield* eventMutations.persistBatches({
								batches,
								batchIndexOffset,
								batch: eventBatch,
								userId: group.userId,
							});
							batchIndexOffset = work.batchIndexOffset;
							if (group.main) {
								results.push(...work.results);
							}
							persistedDispatch.push(...work.dispatch);
						}
						return { results, dispatch: persistedDispatch };
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
						...(saved === undefined ? {} : { entityId: saved.id }),
					};
					return { saved, dispatch, committed, relationships: relationshipResults };
				});
				const write = Effect.fnUntraced(function* (validated: ValidatedPolicies) {
					const groups = yield* eventBatches(validated);
					const accept = acceptRelationshipPolicies(validated.relationships);
					if (input.settings !== undefined && pluginRevision !== null && userId !== null) {
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
						groups.some(({ batches }) => batches.length > 0) ||
						userDataWrites.length > 0
							? yield* sourceWrites(groups, accept, validated.entities)
							: {
									dispatch: [],
									saved: undefined,
									relationships: [],
									committed: { events: [] } satisfies CommittedChanges,
								};
					const dispatch = [...written.dispatch];
					if (ensures) {
						for (const ensured of yield* entities.persistPreparedEnsures(
							ensures,
							validated.entities,
						)) {
							dispatch.push(...ensured.dispatch);
						}
					}
					const deleted: EntityId[] = [];
					for (const prepared of deletes) {
						const work = yield* entities.persistPreparedDeletes(prepared, validated.entities);
						deleted.push(...work.deleted);
						dispatch.push(...work.dispatch);
					}
					const cleared = [];
					for (const prepared of clears) {
						const work = yield* prepared.write(accept);
						cleared.push(work.result);
						dispatch.push(...work.dispatch);
					}
					const merged = [];
					for (const prepared of merges) {
						const work = yield* prepared.write(accept);
						merged.push(work.result);
						dispatch.push(...work.dispatch);
					}
					const savedEntities: Array<CommitResult["entities"][number]> =
						written.saved === undefined || entity === undefined
							? []
							: [{ entity: written.saved, itemIdentity: entity.itemIdentity }];
					if (saves.length > 0) {
						const work = yield* entities.persistPreparedSaves(
							saves.map(({ prepared }) => prepared),
							validated.entities,
							entityBatch,
							savedEntities.length,
						);
						for (const [index, { itemIdentity }] of saves.entries()) {
							const saved = work.entities[index];
							if (!saved) {
								return yield* Effect.die("A persisted entity save is missing its result");
							}
							savedEntities.push({ itemIdentity, entity: saved });
						}
						dispatch.push(...work.dispatch);
					}
					if (savedEntities.length > 0) {
						dispatch.push(...(yield* entities.planEntityBatch(entityBatch)));
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
							deleted,
							outcomes,
							entities: savedEntities,
							committed: written.committed,
							relationships: written.relationships,
						} satisfies CommitResult,
					};
				});
				return {
					write,
					planPolicies,
					validatePolicies,
					kept: () => kept,
					createCount: creates.length,
				};
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
				const prepared = yield* prepareChanges(input, command, pluginRevision, options);
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
								...(group.paging ? { paging: group.paging } : {}),
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
				const writeAll = Effect.fnUntraced(function* (validated: ValidatedPolicies) {
					const written = yield* prepared.write(validated);
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
				const unchecked = Effect.map(settledByReceipt(receipt, precondition), (value) =>
					value === null ? null : settled(value),
				);
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
							const planned = yield* prepared.planPolicies;
							if (
								[
									...planned.events.flatMap(({ chunks }) => chunks),
									...planned.relationships,
									...planned.entities,
								].every(({ matched }) => matched === null)
							) {
								return {
									kind: "committed" as const,
									committed: yield* writeAll(yield* prepared.validatePolicies(planned)),
								};
							}
							return { planned, kind: "policies" as const };
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
					const validated = yield* prepared.validatePolicies(started.planned);
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
							options.events?.independent
								? new EventCreateRejected({ kept: prepared.kept(), reason: commitRejection(error) })
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
											outcomes: rejectedOutcomes(rejection, prepared.createCount),
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
			 * result or a failed precondition ends the commit before preparation, and again inside the
			 * transaction, where no write precedes it.
			 */
			const commitOnce = Effect.fn("ChangeSets.commitOnce")(function* <A>(
				input: Changes,
				command: DomainLifecycleCommand,
				receipt: CommitReceipt<A>,
				options: CommitOptions = {},
			) {
				const settled = yield* inTransaction(settledByReceipt(receipt, options.precondition));
				return settled ?? (yield* commitKernel(input, command, receipt, options));
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
