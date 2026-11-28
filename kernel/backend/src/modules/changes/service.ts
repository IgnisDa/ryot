import { BadRequest, DbError, NotFound, ValidationFailed } from "@ryot-app/contract/errors";
import type { ChangeSet, CommittedChanges } from "@ryot-app/contract/modules/changes/change-set";
import { PolicyRejected, PolicyUnavailable } from "@ryot-app/contract/modules/changes/policies";
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
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Context, DateTime, Effect, Function, Layer, Result, Schema } from "effect";

import { ManagedAssetReferenceRejected } from "#lib/domain/managed-asset-writes";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecycleDispatchPlan,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import {
	applyPolicies,
	type LifecyclePolicies,
	type MatchedPolicyChunk,
	type PolicyDecisions,
	unchangedPolicies,
	unmatchedPolicies,
} from "#modules/automations/lifecycle/policies";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { DefinitionReadUnavailable } from "#modules/definitions/read-context";
import { FoldMarks } from "#modules/derived-values/marks";
import type { PreparedEntityCreate } from "#modules/entities/prepared-entity-create";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	acceptEntityPolicies,
	EntitiesService,
	entityDeleteEvents,
	EntityMatchAppeared,
	type EntityPolicyAcceptance,
	entityPolicyItems,
	entitySaveDraft,
	matchEntityPolicies,
} from "#modules/entities/service";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import {
	type DomainLifecycleCommand,
	DomainWriteChecks,
	DomainWriteConflict,
	kernelCollectionLifecycleCommand,
} from "#modules/entities/write-context";
import { eventReferenceBadRequest } from "#modules/events/event-references";
import {
	acceptedEventBatches,
	type EventMutation,
	EventMutations,
	eventPolicyItems,
	matchesExpectedFields,
	matchEventPolicies,
	type PreparedEventChanges,
} from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import {
	type CommitReceipt,
	idempotencyIdentity,
	IdempotencyKeys,
	keyedReceipt,
	unrecorded,
} from "#modules/mutations/idempotency";
import { NotificationsService } from "#modules/notifications/service";
import {
	PluginUserSettingsPatchError,
	PluginUserSettingsWriter,
} from "#modules/plugins/preferences/user-settings-writer";
import {
	acceptRelationshipPolicies,
	matchRelationshipPolicies,
	preparedRelationshipEntityIds,
	type PreparedUserRelationship,
	type UserRelationshipMode,
} from "#modules/relationships/prepared-mutations";
import { relationshipMutationLockKey } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import type {
	ScriptExecutionPrincipal,
	ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { WritePreparation, WriteTransaction } from "#platform/db/write-transaction";

import {
	authorizeChangeSet,
	type ChangeSetAuthority,
	changeSetReferences,
	ChangeSetRejected,
	undeclaredSchema,
} from "./authority";
import {
	type Changes,
	changesParts,
	type EntityReference,
	eventMutation,
	fromScriptChangeSet,
	type GlobalEntityReference,
	scriptChangeSetParts,
} from "./changes";
import {
	commitRejection,
	EventCreateRejected,
	policyOutcomes,
	rejectedOutcomes,
	sortedOutcomes,
	toCreateEventsResponse,
} from "./outcomes";
import { type CommitResult, emptyCommitResult } from "./receipts";

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
	PolicyRejected,
	PolicyUnavailable,
	PluginUserSettingsPatchError,
	ChangeSetRejected,
]);

/** A command whose write context is the writing script's principal. */
export type ScriptLifecycleCommand = DomainLifecycleCommand & {
	readonly writeContext: ScriptExecutionPrincipal;
};

/**
 * `verbatimIdentities` keeps each entity (global upserts included), event or relationship item's own
 * identity rather than prefixing it with the command's. `queueFolds` queues the folds the commit
 * marks whatever its lane.
 */
export type CommitOptions<E = never> = {
	readonly queueFolds?: true;
	readonly precondition?: CommitPrecondition<E>;
	readonly entities?: { readonly verbatimIdentities: true };
	readonly relationships?: { readonly verbatimIdentities: true };
	readonly events?: { readonly independent?: true; readonly verbatimIdentities?: true };
};

type Writer =
	| { readonly kind: "kernel" }
	| {
			readonly kind: "script";
			readonly authority: ChangeSetAuthority;
			readonly principal: ScriptExecutionPrincipal;
	  };

/**
 * Durable state the commit consults: `check` runs before preparation and again in the commit
 * transaction after its catalog lock, each time given that transaction's `WriteTransaction`, where
 * false records an empty result and a failure fails the commit; `lock` runs first in each of those
 * transactions, before the catalog lock; `written` runs after every write of a commit that wrote
 * anything, with what it wrote.
 */
type CommitPrecondition<E> = {
	readonly written: (result: CommitResult) => Effect.Effect<void, DbError>;
	readonly lock?: (transaction: WriteTransaction) => Effect.Effect<void, DbError>;
	readonly check: (transaction: WriteTransaction) => Effect.Effect<boolean, E | DbError>;
};

/** Whether committing the change set would write nothing. */
const isEmptyChangeSet = (changes: ChangeSet) =>
	!scriptChangeSetParts.some(({ present }) => present(changes));

/** A part only a script writer's principal resolves. */
const scriptOnlyPart = (changes: Changes) =>
	changesParts.find(({ script, present }) => script === true && present(changes))?.part;

/** A part only a change set with a user writes; a create's match finds the user's entity. */
const userOnlyPart = (changes: Changes) =>
	changesParts.find(({ user, present }) => user === true && present(changes))?.part ??
	(changes.entities?.creates?.some((item) => item.match !== undefined) === true
		? "entities.creates"
		: undefined);

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

const upsertKey = (entitySchemaSlug: string, externalId: string) =>
	stableStringify([entitySchemaSlug, externalId]);

const upsertedKey = (
	entitySchemaSlug: string,
	externalId: string,
	providerId: undefined | SandboxProviderId,
) => stableStringify([entitySchemaSlug, externalId, providerId ?? null]);

/** Whether a commit wrote anything its precondition's `written` records. */
const wroteAnything = (result: CommitResult) =>
	result.signals.length > 0 ||
	result.entities.length > 0 ||
	result.deleted.length > 0 ||
	result.cleared.length > 0 ||
	result.merged.length > 0 ||
	result.committed.events.length > 0 ||
	result.relationships.some(({ operation }) => operation !== "noop");

const globalReferences = (group: NonNullable<Changes["globalRelationships"]>[number]) => [
	...(group.selector.type === "anchored" ? [group.selector.anchor] : []),
	...group.relationships.flatMap(({ source, target }) => [source, target]),
];

type PreparedEventChange = PreparedEventChanges["items"][number];

type EntitySave = {
	readonly itemIdentity: string;
	readonly prepared: Prepared<"prepareSave">;
};

/** A user relationship change prepared under its item identity; null when it prepares nothing. */
type PreparedRelationship = {
	readonly itemIdentity: string;
	readonly prepared: null | PreparedUserRelationship;
};

type EntityResolver = (
	reference: EntityReference,
) => Effect.Effect<EntityId, EventBadRequest | ChangeSetRejected>;

type Prepared<K extends keyof EntitiesService["Service"]> = Effect.Success<
	ReturnType<EntitiesService["Service"][K]>
>;

type PreparedUserData<K extends keyof EntityUserDataService["Service"]> = Effect.Success<
	ReturnType<EntityUserDataService["Service"][K]>
>;

type EventBatch = {
	readonly validated: PolicyDecisions;
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
	/** The outcomes of independent creates that failed preparation. */
	readonly kept: ReadonlyArray<EventCreateItemOutcome>;
	readonly relationships: ReadonlyArray<{ readonly decisions: PolicyDecisions }>;
	readonly events: ReadonlyArray<{
		readonly group: EventGroup;
		readonly prepared: PreparedEventChanges;
		readonly chunks: ReadonlyArray<{
			readonly decisions: PolicyDecisions;
			readonly items: ReadonlyArray<PreparedEventChange>;
		}>;
	}>;
};

/** A change set prepared outside the commit, which its policy and write steps take. */
type PreparedChanges = {
	readonly input: Changes;
	readonly entityOf: EntityResolver;
	readonly rootId: EntityId | undefined;
	readonly command: DomainLifecycleCommand;
	readonly options: CommitOptions<unknown>;
	/** The root entity, then entity creates, references and updates. */
	readonly saves: ReadonlyArray<EntitySave>;
	/** Each event create's position among the change set's creates, by item identity. */
	readonly creates: ReadonlyMap<string, number>;
	readonly eventGroups: ReadonlyArray<EventGroup>;
	readonly pluginRevision: null | ScriptPluginRevision;
	readonly ensures: undefined | Prepared<"prepareEnsures">;
	readonly deletes: ReadonlyArray<Prepared<"prepareDeletes">>;
	readonly relationships: ReadonlyArray<PreparedRelationship>;
	readonly clears: ReadonlyArray<PreparedUserData<"prepareClear">>;
	readonly merges: ReadonlyArray<PreparedUserData<"prepareMerge">>;
};

const requireUser = (userId: null | UserId) =>
	userId === null
		? Effect.die("A user part reached a change set without a user")
		: Effect.succeed(userId);

/**
 * An item's lifecycle command, under the command's item identity unless `verbatim`, and under the
 * kernel collection for a part `CollectionsService` built.
 */
const identityCommand = (
	command: DomainLifecycleCommand,
	verbatim: undefined | { readonly verbatimIdentities: true },
	itemIdentity: string,
	part: { readonly kernelCollection?: true } = {},
) => {
	const itemScoped = verbatim ? { ...command, itemIdentity } : itemCommand(command, itemIdentity);
	return part.kernelCollection ? kernelCollectionLifecycleCommand(itemScoped) : itemScoped;
};

/** Resolves a user entity reference: an existing entity, the root, or one the change set keys. */
const entityResolver =
	(rootId: EntityId | undefined, keyed: ReadonlyMap<string, EntityId>): EntityResolver =>
	(reference) => {
		if (reference.kind === "existing") {
			return Effect.succeed(reference.entityId);
		}
		if (reference.kind === "keyed") {
			const keyedId = keyed.get(reference.key);
			return keyedId === undefined
				? Effect.fail(
						new ChangeSetRejected({
							part: "entities",
							message: `No entity has key ${reference.key}`,
						}),
					)
				: Effect.succeed(keyedId);
		}
		return rootId === undefined ? Effect.fail(rootRequired()) : Effect.succeed(rootId);
	};

/** Entity deletes grouped by schema and history preservation, under their group key. */
const deleteGroups = (deletes: NonNullable<NonNullable<Changes["entities"]>["deletes"]>) => {
	const groups = new Map<
		string,
		{
			readonly preserveHistory: boolean;
			readonly ids: [EntityId, ...EntityId[]];
			readonly entitySchema: NonNullable<Changes["entity"]>["entitySchema"];
		}
	>();
	for (const { entityId, entitySchema, preserveHistory } of deletes) {
		const key = stableStringify([entitySchema, preserveHistory === true]);
		const group = groups.get(key);
		if (group) {
			group.ids.push(entityId);
		} else {
			groups.set(key, { entitySchema, ids: [entityId], preserveHistory: preserveHistory === true });
		}
	}
	return groups;
};

/**
 * The change set's event groups: its own event changes, joined by its entity deletes' cascade to its
 * user and each clear's and merge's event changes, then each cascade to another user. A repeated
 * item identity or changed event fails the change set.
 */
const groupEventChanges = Effect.fnUntraced(function* (
	input: Changes,
	command: DomainLifecycleCommand,
	eventChanges: ReadonlyArray<EventMutation>,
	cascades: ReturnType<typeof entityDeleteEvents>,
	userData: {
		readonly clears: ReadonlyArray<{ readonly events: ReadonlyArray<EventMutation> }>;
		readonly merges: ReadonlyArray<{ readonly events: ReadonlyArray<EventMutation> }>;
	},
) {
	const { userId } = input;
	const changes: EventMutation[] = [
		...eventChanges,
		...cascades.flatMap((cascade) =>
			cascade.userId === userId ? cascade.changes.map(prefixed("entity-delete")) : [],
		),
		...userData.clears.flatMap((prepared, index) =>
			prepared.events.map(prefixed(`entity-clear:${index}`)),
		),
		...userData.merges.flatMap((prepared, index) =>
			prepared.events.map(prefixed(`entity-merge:${index}`)),
		),
	];
	const eventIdentities = [
		...changes.map((item) => item.itemIdentity),
		...(input.relationships?.events ?? []).map((event) => event.itemIdentity),
	];
	if (new Set(eventIdentities).size !== eventIdentities.length) {
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
	const groups: ReadonlyArray<EventGroup> = [
		...(changes.length === 0
			? []
			: [{ changes, command, main: true, userId: yield* requireUser(userId) }]),
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
	return groups;
});

/** A create's position among the change set's event creates; -1 for any other item. */
const createIndex = (prepared: PreparedChanges, itemIdentity: string) =>
	prepared.creates.get(itemIdentity) ?? -1;

const entityBatch = (command: DomainLifecycleCommand) => ({ command, identity: ["entities"] });

/** Each save's draft as `accept` leaves it, by entity. */
const savedDrafts = (saves: ReadonlyArray<EntitySave>, accept?: EntityPolicyAcceptance) =>
	Effect.map(
		Effect.forEach(saves, ({ prepared }) =>
			Effect.map(entitySaveDraft(prepared, accept), (draft) =>
				draft === null ? [] : [[prepared.entityId, draft] as const],
			),
		),
		(entries) => new Map(entries.flat()),
	);

/** An independent commit's bad request fails every event create but those `kept` holds. */
const rejectCreates =
	(options: CommitOptions<unknown>, kept: ReadonlyArray<EventCreateItemOutcome>) =>
	(error: EventBadRequest) =>
		Effect.fail(
			options.events?.independent === true
				? new EventCreateRejected({ kept, reason: commitRejection(error) })
				: error,
		);

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

/**
 * What settles a commit before it writes: the result a receipt recorded or a false precondition
 * records, or the precondition's refusal; null commits.
 */
const settledByReceipt = <A, E>(
	receipt: CommitReceipt<CommitResult, A>,
	transaction: WriteTransaction,
	precondition?: CommitPrecondition<E>,
) =>
	Effect.gen(function* (): Effect.fn.Return<
		null | { readonly value: A } | { readonly refused: E },
		DbError
	> {
		const stored = yield* receipt.load;
		if (stored !== null) {
			return { value: stored };
		}
		if (!precondition) {
			return null;
		}
		const checked = yield* precondition.check(transaction).pipe(
			Effect.map((holds) => ({ holds })),
			Effect.catchIf(
				(error): error is E => !(error instanceof DbError),
				(refused) => Effect.succeed({ refused }),
			),
		);
		if ("refused" in checked) {
			return checked;
		}
		return checked.holds ? null : { value: yield* receipt.record(emptyCommitResult) };
	});

/**
 * A script's reference to an entity or event it may not name. A clear or merge of one names entities
 * the user chose, so it is refused like a merge of entities of different schemas.
 */
const referenceRejected = (part: string, message: string) =>
	part === "entities.clears" || part === "entities.merges"
		? new EntityUserDataBadRequest({ reason: { code: "entity-schema-mismatch" } })
		: new ChangeSetRejected({ part, message });

// A create whose match appeared since preparation prepares again, so its match keeps that entity.
const rematchOnce = <A, E, R>(work: Effect.Effect<A, E | EntityMatchAppeared, R>) =>
	work.pipe(
		Effect.retry({ times: 1, while: (error) => error instanceof EntityMatchAppeared }),
		Effect.catchTag("EntityMatchAppeared", () =>
			Effect.fail(new EntityBadRequest({ reason: { code: "mutation-conflict" } })),
		),
	);

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
			const writeChecks = yield* DomainWriteChecks;
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
						return found !== undefined && found.entitySchemaPluginId !== pluginId;
					}) ??
					referenced.events.find(([, eventId]) => {
						const found = eventOwners.get(eventId);
						return found !== undefined && found.eventSchemaPluginId !== pluginId;
					});
				if (foreign) {
					const [part, id] = foreign;
					return yield* referenceRejected(part, `${id} belongs to another plugin`);
				}
				const otherUserEntity = referenced.entities.find(([, entityId]) => {
					const owner = entityOwners.get(entityId)?.entityUserId ?? null;
					return owner !== null && owner !== userId;
				});
				if (otherUserEntity) {
					return yield* new EntityNotFound({
						reason: { code: "entity-not-found", entityId: otherUserEntity[1] },
					});
				}
				const otherUserEvent = referenced.events.find(([, eventId]) => {
					const found = eventOwners.get(eventId);
					return found !== undefined && found.userId !== userId;
				});
				if (otherUserEvent) {
					return yield* new EventNotFound({
						reason: { code: "event-not-found", eventId: otherUserEvent[1] },
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
					return yield* referenceRejected(part, `${id} is not a ${entitySchemaSlug} entity`);
				}
				return yield* Effect.void;
			});
			/**
			 * The root entity, entity creates, references and updates, each prepared under its item identity
			 * with the root first, and the entities they key.
			 */
			const prepareEntitySaves = Effect.fnUntraced(function* (
				preparation: WritePreparation,
				input: Changes,
				command: DomainLifecycleCommand,
				options: CommitOptions<unknown>,
			) {
				const { userId } = input;
				const prepareEntitySave = (
					item: {
						readonly name: string;
						readonly properties: unknown;
						readonly kernelCollection?: true;
						readonly populatedAt?: null | string;
						readonly entitySchema: NonNullable<Changes["entity"]>["entitySchema"];
					},
					itemIdentity: string,
					target: Parameters<typeof entities.prepareSave>[1]["target"],
				) =>
					entities
						.prepareSave(preparation, {
							target,
							name: item.name,
							scopeUserId: userId,
							properties: item.properties,
							entitySchema: item.entitySchema,
							lifecycle: identityCommand(command, options.entities, itemIdentity, item),
							...(item.populatedAt === undefined ? {} : { populatedAt: item.populatedAt }),
						})
						.pipe(Effect.map((prepared): EntitySave => ({ prepared, itemIdentity })));
				const root =
					input.entity === undefined
						? undefined
						: yield* prepareEntitySave(
								input.entity,
								input.entity.itemIdentity ?? "entity",
								input.entity.target,
							);
				const saves: EntitySave[] = root === undefined ? [] : [root];
				const keyed = new Map<string, EntityId>();
				const keySave = (key: string | undefined, save: EntitySave) => {
					saves.push(save);
					if (key === undefined) {
						return Effect.void;
					}
					if (keyed.has(key)) {
						return Effect.fail(
							new ChangeSetRejected({ part: "entities", message: `Entity key ${key} repeats` }),
						);
					}
					keyed.set(key, save.prepared.entityId);
					return Effect.void;
				};
				for (const [index, item] of (input.entities?.creates ?? []).entries()) {
					const itemIdentity = item.itemIdentity ?? `entity-create:${index}`;
					const { match } = item;
					const matched =
						match === undefined
							? null
							: yield* entities.prepareMatch(preparation, {
									match,
									entitySchema: item.entitySchema,
									userId: yield* requireUser(userId),
									lifecycle: identityCommand(command, options.entities, itemIdentity, item),
								});
					if (matched === null && match?.required === true) {
						return yield* new ChangeSetRejected({
							part: "entities.creates",
							message: `${itemIdentity} matches no entity`,
						});
					}
					yield* keySave(
						item.key,
						matched === null
							? yield* prepareEntitySave(item, itemIdentity, {
									kind: "create",
									...(item.provider ? { provider: item.provider } : {}),
									...(item.externalId === undefined ? {} : { externalId: item.externalId }),
									...(match === undefined || "entityId" in match ? {} : { unmatched: match }),
								})
							: { itemIdentity, prepared: matched },
					);
				}
				for (const [index, item] of (input.entities?.references ?? []).entries()) {
					const itemIdentity = item.itemIdentity ?? `entity-reference:${index}`;
					const prepared = yield* entities.prepareMatch(preparation, {
						entitySchema: item.entitySchema,
						userId: yield* requireUser(userId),
						match: { entityId: item.entityId },
						lifecycle: identityCommand(command, options.entities, itemIdentity),
					});
					if (prepared === null) {
						return yield* Effect.die("A referenced entity is outside the user's scope");
					}
					yield* keySave(item.key, { prepared, itemIdentity });
				}
				for (const item of sortBy(
					input.entities?.updates ?? [],
					(update) => update.target.entityId,
				)) {
					saves.push(
						yield* prepareEntitySave(
							item,
							item.itemIdentity ?? `entity-update:${item.target.entityId}`,
							item.target,
						),
					);
				}
				return { root, saves, keyed };
			});
			/**
			 * The change set's user relationship changes, each prepared under its item identity; a delete by
			 * ID of a relationship the user does not have prepares nothing.
			 */
			const prepareRelationshipWrites = Effect.fnUntraced(function* (
				preparation: WritePreparation,
				input: Changes,
				command: DomainLifecycleCommand,
				options: CommitOptions<unknown>,
				entityOf: EntityResolver,
				createdEntities: ReadonlyArray<PreparedEntityCreate>,
			) {
				const { userId } = input;
				const relationshipInput = Effect.fnUntraced(function* (
					relation: NonNullable<NonNullable<Changes["relationships"]>["deletes"]>[number],
				) {
					return {
						scope: "user" as const,
						userId: yield* requireUser(userId),
						relationshipSchema: relation.relationshipSchema,
						...(relation.key === undefined ? {} : { key: relation.key }),
						sourceEntityId: yield* entityOf(relation.source),
						targetEntityId: yield* entityOf(relation.target),
					};
				});
				const parts = input.relationships ?? {};
				const prepared: PreparedRelationship[] = [];
				const prepareWrite = Effect.fnUntraced(function* (
					relation: NonNullable<(typeof parts)["updates"]>[number],
					mode: UserRelationshipMode,
					itemIdentity: string,
				) {
					prepared.push({
						itemIdentity,
						prepared: yield* relationships.prepareUserWrite(
							preparation,
							{ ...(yield* relationshipInput(relation)), properties: relation.properties },
							identityCommand(command, options.relationships, itemIdentity, relation),
							mode,
							createdEntities,
							relation.expected ?? {},
						),
					});
				});
				for (const [index, relation] of (parts.upserts ?? []).entries()) {
					yield* prepareWrite(
						relation,
						relation.propertiesMode === "merge" ? "merge" : "upsert",
						relation.itemIdentity ?? `relationship:${index}`,
					);
				}
				for (const [index, relation] of (parts.updates ?? []).entries()) {
					yield* prepareWrite(
						relation,
						"update",
						relation.itemIdentity ?? `relationship-update:${index}`,
					);
				}
				for (const [index, relation] of (parts.ensures ?? []).entries()) {
					yield* prepareWrite(
						relation,
						"ensure",
						relation.itemIdentity ?? `relationship-ensure:${index}`,
					);
				}
				for (const [index, relation] of (parts.deletes ?? []).entries()) {
					const itemIdentity = relation.itemIdentity ?? `relationship-delete:${index}`;
					prepared.push({
						itemIdentity,
						prepared: yield* relationships.prepareUserDelete(
							preparation,
							yield* relationshipInput(relation),
							identityCommand(command, options.relationships, itemIdentity),
						),
					});
				}
				for (const [index, relation] of (parts.deletesById ?? []).entries()) {
					const itemIdentity = relation.itemIdentity ?? `relationship-delete-by-id:${index}`;
					prepared.push({
						itemIdentity,
						prepared: yield* relationships.prepareUserDeleteById(
							preparation,
							yield* requireUser(userId),
							relation.relationshipId,
							identityCommand(command, options.relationships, itemIdentity),
						),
					});
				}
				return prepared;
			});
			/** The entity deletes, prepared once per schema and history preservation. */
			const prepareEntityDeletes = (
				preparation: WritePreparation,
				input: Changes,
				command: DomainLifecycleCommand,
			) =>
				Effect.forEach(
					deleteGroups(input.entities?.deletes ?? []).entries(),
					([key, { ids, entitySchema, preserveHistory }]) =>
						entities.prepareDeletes(
							preparation,
							ids,
							itemCommand(command, `entity-deletes:${key}`),
							{ entitySchema, preserveHistory, scopeUserId: input.userId },
						),
				);
			/** The data clears and merges, leaving the relationships `written` names to the change set. */
			const prepareUserData = Effect.fnUntraced(function* (
				preparation: WritePreparation,
				input: Changes,
				command: DomainLifecycleCommand,
				written: ReadonlySet<string>,
			) {
				const clears = yield* Effect.forEach(
					(input.entities?.clears ?? []).entries(),
					([index, item]) =>
						Effect.flatMap(requireUser(input.userId), (owner) =>
							userData.prepareClear(
								preparation,
								owner,
								item,
								kernelCollectionLifecycleCommand(itemCommand(command, `entity-clear:${index}`)),
								written,
							),
						),
				);
				const merges = yield* Effect.forEach(
					(input.entities?.merges ?? []).entries(),
					([index, item]) =>
						Effect.flatMap(requireUser(input.userId), (owner) =>
							userData.prepareMerge(
								preparation,
								owner,
								item,
								kernelCollectionLifecycleCommand(itemCommand(command, `entity-merge:${index}`)),
								written,
							),
						),
				);
				return { clears, merges };
			});
			/** Prepares every part of a change set outside the commit, in the order its parts commit. */
			const prepareChanges = Effect.fn("ChangeSets.prepareChanges")(function* (
				preparation: WritePreparation,
				input: Changes,
				command: DomainLifecycleCommand,
				pluginRevision: null | ScriptPluginRevision,
				options: CommitOptions<unknown>,
			) {
				const userPart = input.userId === null ? userOnlyPart(input) : undefined;
				if (userPart !== undefined) {
					return yield* new ChangeSetRejected({
						part: userPart,
						message: `${userPart} requires a user`,
					});
				}
				if (input.entity === undefined && input.events?.expected !== undefined) {
					return yield* rootRequired();
				}
				const { root, saves, keyed } = yield* prepareEntitySaves(
					preparation,
					input,
					command,
					options,
				);
				const entityOf = entityResolver(root?.prepared.entityId, keyed);
				const eventChanges = yield* Effect.forEach(input.events?.changes ?? [], (change) =>
					eventMutation(change, entityOf),
				);
				const relationshipWrites = yield* prepareRelationshipWrites(
					preparation,
					input,
					command,
					options,
					entityOf,
					saves.flatMap((save) => (save.prepared.created ? [save.prepared.created] : [])),
				);
				const ensures = input.entities?.ensures?.length
					? yield* entities.prepareEnsures(
							preparation,
							yield* requireUser(input.userId),
							input.entities.ensures,
							itemCommand(command, "ensures"),
						)
					: undefined;
				const deletes = yield* prepareEntityDeletes(preparation, input, command);
				const { clears, merges } = yield* prepareUserData(
					preparation,
					input,
					command,
					new Set(
						relationshipWrites.flatMap(({ prepared }) =>
							prepared === null ? [] : [relationshipMutationLockKey(prepared.mutation.input)],
						),
					),
				);
				const eventGroups = yield* groupEventChanges(
					input,
					command,
					eventChanges,
					deletes.flatMap(entityDeleteEvents),
					{ clears, merges },
				);
				const creates = eventChanges.flatMap((change) =>
					change.kind === "create" ? [change.itemIdentity] : [],
				);
				return {
					input,
					saves,
					clears,
					merges,
					command,
					options,
					deletes,
					ensures,
					entityOf,
					eventGroups,
					pluginRevision,
					rootId: root?.prepared.entityId,
					relationships: relationshipWrites,
					creates: new Map(creates.map((itemIdentity, index) => [itemIdentity, index])),
				} satisfies PreparedChanges;
			});
			/**
			 * Matches every policy batch of the prepared changes in the transaction, preparing their event
			 * changes; `kept` holds the outcomes of independent creates that failed preparation.
			 */
			const planPolicies = Effect.fnUntraced(function* (
				prepared: PreparedChanges,
				transaction: WriteTransaction,
			) {
				const { input, command, options } = prepared;
				const independent = options.events?.independent === true;
				const proposedEntities = Object.fromEntries(yield* savedDrafts(prepared.saves));
				const events = yield* Effect.forEach(prepared.eventGroups, (group) =>
					Effect.gen(function* () {
						const changes = yield* eventMutations
							.prepare(transaction, {
								userId: group.userId,
								command: group.command,
								changes: group.changes,
								...(group.main
									? {
											independent,
											proposedEntities,
											verbatimIdentities: options.events?.verbatimIdentities === true,
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
						const chunks = yield* matchEventPolicies({
							transaction,
							prepared: changes,
							userId: group.userId,
							command: group.command,
						}).pipe(Effect.provideContext(policyContext));
						return { group, chunks, prepared: changes };
					}),
				);
				const relationshipTokens = [
					...prepared.relationships.flatMap((write) =>
						write.prepared === null ? [] : [write.prepared],
					),
					...[...prepared.clears, ...prepared.merges].flatMap(
						(userDataWrite) => userDataWrite.relationships,
					),
				];
				return {
					events,
					kept: (events.find(({ group }) => group.main)?.prepared.failures ?? []).map(
						({ reason, itemIdentity }) => ({
							reason,
							status: "failed" as const,
							index: createIndex(prepared, itemIdentity),
						}),
					),
					relationships:
						relationshipTokens.length === 0
							? []
							: yield* matchRelationshipPolicies({
									command,
									transaction,
									prepared: relationshipTokens,
									userId: yield* requireUser(input.userId),
								}).pipe(Effect.provideContext(policyContext)),
					entities: yield* matchEntityPolicies({
						command,
						transaction,
						userId: input.userId,
						items: [
							...prepared.saves.map(({ prepared: save }) => save),
							...(prepared.ensures === undefined ? [] : [prepared.ensures]),
							...prepared.deletes,
						].flatMap(entityPolicyItems),
					}).pipe(Effect.provideContext(policyContext)),
				};
			});
			type PlannedPolicies = Effect.Success<ReturnType<typeof planPolicies>>;
			/**
			 * Calls every matched policy outside any transaction. When one cannot run, an independent commit
			 * fails every create but those `planned.kept` holds.
			 */
			const validatePolicies = Effect.fnUntraced(function* (
				prepared: PreparedChanges,
				planned: PlannedPolicies,
			) {
				const independentPolicyFailure = <E extends PolicyRejected | PolicyUnavailable>(
					error: E,
				) =>
					prepared.options.events?.independent === true
						? new EventCreateRejected({
								kept: planned.kept,
								reason: { code: "policy-execution-failed" },
							})
						: error;
				const acceptEntity = acceptEntityPolicies(
					yield* applyPolicies(planned.entities).pipe(Effect.provideContext(policyContext)),
				);
				const accepted = yield* savedDrafts(prepared.saves, acceptEntity);
				const withAcceptedEntities = <T>(chunk: MatchedPolicyChunk<T>): MatchedPolicyChunk<T> => {
					const { references } = chunk.request;
					if (!Object.keys(references).some((id) => accepted.has(EntityId.make(id)))) {
						return chunk;
					}
					const current = Object.fromEntries(
						Object.entries(references).map(([id, draft]) => [
							id,
							accepted.get(EntityId.make(id)) ?? draft,
						]),
					);
					return {
						...chunk,
						request: { ...chunk.request, references: current },
						decisions: { ...chunk.decisions, references: current },
					};
				};
				const eventPolicies = yield* Effect.forEach(planned.events, (group) =>
					applyPolicies(group.chunks.map(withAcceptedEntities)).pipe(
						Effect.map((chunks) => ({ ...group, chunks })),
						Effect.provideContext(policyContext),
					),
				).pipe(
					Effect.catchTags({
						PolicyRejected: (error) => Effect.fail(independentPolicyFailure(error)),
						PolicyUnavailable: (error) => Effect.fail(independentPolicyFailure(error)),
					}),
				);
				return {
					kept: planned.kept,
					events: eventPolicies,
					entities: acceptEntity,
					relationships: yield* applyPolicies(planned.relationships).pipe(
						Effect.provideContext(policyContext),
					),
				} satisfies ValidatedPolicies;
			});
			/**
			 * Each event group's accepted batches. An independent commit's main group keeps the creates its
			 * policies accepted, and `kept` adds the outcomes of those they skipped or failed.
			 */
			const eventBatches = Effect.fnUntraced(function* (
				prepared: PreparedChanges,
				validated: ValidatedPolicies,
			) {
				const { command, options } = prepared;
				const groups = yield* Effect.forEach(
					validated.events,
					({ group, chunks, prepared: events }) =>
						Effect.gen(function* () {
							if (!group.main || options.events?.independent !== true) {
								return {
									group,
									kept: [],
									batches: yield* acceptedEventBatches({
										chunks,
										prepared: events,
										command: group.command,
									}),
								};
							}
							const decided = chunks.map((chunk) => ({
								chunk,
								...policyOutcomes(chunk.decisions, (itemIdentity) =>
									createIndex(prepared, itemIdentity),
								),
							}));
							return {
								group,
								kept: decided.flatMap(({ outcomes }) => outcomes),
								batches: decided.flatMap(({ chunk, accepted }): ReadonlyArray<EventBatch> => {
									const items = chunk.items.filter((item) =>
										accepted.has(item.change.itemIdentity),
									);
									return items.length === 0
										? []
										: [{ command, validated: chunk.decisions, prepared: { ...events, items } }];
								}),
							};
						}),
				);
				return {
					groups: groups.map(({ group, batches }) => ({ group, batches })),
					kept: [...validated.kept, ...groups.flatMap(({ kept }) => kept)],
				};
			});
			/** Persists every entity save as one set, answering each saved entity under its item identity. */
			const persistSaves = Effect.fnUntraced(function* (
				prepared: PreparedChanges,
				transaction: WriteTransaction,
				acceptEntity: EntityPolicyAcceptance,
			) {
				const { saves } = prepared;
				if (saves.length === 0) {
					return { entities: [], dispatch: [] };
				}
				const work = yield* entities.persistPreparedSaves(
					transaction,
					saves.map((save) => save.prepared),
					acceptEntity,
					entityBatch(prepared.command),
					0,
				);
				return {
					dispatch: work.dispatch,
					entities: yield* Effect.forEach(saves, ({ itemIdentity }, index) => {
						const saved = work.entities[index];
						return saved
							? Effect.succeed({ itemIdentity, entity: saved })
							: Effect.die("A persisted entity save is missing its result");
					}),
				};
			});
			/**
			 * The source writes: the event groups' capture and the clears' and merges' locks and rechecks,
			 * then the entity saves, relationships, the events relationship changes record, events and
			 * baselines. An independent commit's write failure fails every create but those `kept` holds.
			 */
			const sourceWrites = Effect.fnUntraced(function* (
				prepared: PreparedChanges,
				transaction: WriteTransaction,
				batches: Effect.Success<ReturnType<typeof eventBatches>>,
				accept: ReturnType<typeof acceptRelationshipPolicies>,
				acceptEntity: EntityPolicyAcceptance,
			) {
				const { input, rootId, command, options } = prepared;
				const { userId } = input;
				const { kept, groups } = batches;
				const independent = options.events?.independent === true;
				const pluginId = prepared.pluginRevision?.id ?? null;
				const events: NonNullable<Changes["events"]> = input.events ?? { changes: [] };
				const userDataWrites = [...prepared.clears, ...prepared.merges];
				const main = groups.find(({ group }) => group.main)?.batches ?? [];
				const dispatch: LifecycleDispatchPlan[] = [];
				const relationshipResults: Array<CommitResult["relationships"][number]> = [];
				const recorded: EventBatch[] = [];
				const sources =
					rootId !== undefined ||
					prepared.relationships.length > 0 ||
					userDataWrites.length > 0 ||
					groups.some(({ batches: groupBatches }) => groupBatches.length > 0);
				if (userId !== null && sources) {
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
							...main.flatMap((batch) =>
								Object.keys(batch.validated.references).map((id) => EntityId.make(id)),
							),
							...prepared.relationships.flatMap((write) =>
								write.prepared === null ? [] : preparedRelationshipEntityIds(write.prepared),
							),
							...userDataWrites.flatMap((userDataWrite) => userDataWrite.entityIds),
						]),
					].sort();
					const lockedEntityIds = yield* eventMutations.captureGroups(transaction, {
						userId,
						batches: main,
						entityIds: references,
					});
					const lockedReferences = yield* entityRows.getMutationEntities(lockedEntityIds, true);
					for (const userDataWrite of userDataWrites) {
						yield* userDataWrite.lock(transaction);
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
				}
				const saved = yield* persistSaves(prepared, transaction, acceptEntity);
				if (!sources) {
					return {
						dispatch: saved.dispatch,
						entities: saved.entities,
						relationships: relationshipResults,
						committed: { events: [] } satisfies CommittedChanges,
					};
				}
				dispatch.push(...saved.dispatch);
				if (userId !== null) {
					yield* eventMutations.lockPreparedChanges({ userId, batches: main });
					if (prepared.relationships.length > 0) {
						const batch = {
							command,
							identity: ["relationships"],
							resource: "relationship" as const,
						};
						yield* planner.prepareBatch(transaction, { ...batch, scopes: [userId] });
						for (const [index, write] of prepared.relationships.entries()) {
							if (write.prepared === null) {
								relationshipResults.push({
									operation: "noop",
									relationship: null,
									itemIdentity: write.itemIdentity,
								});
								continue;
							}
							const work = yield* relationships.persistPrepared(
								transaction,
								yield* accept(write.prepared),
								{ ...batch, index },
							);
							dispatch.push(...work.dispatch);
							relationshipResults.push({ ...work.result, itemIdentity: write.itemIdentity });
						}
						dispatch.push(...(yield* planner.planBatch(transaction, batch)));
					}
					const recordedChanges: EventMutation[] = [];
					for (const event of input.relationships?.events ?? []) {
						const written = relationshipResults.find(
							({ itemIdentity }) => itemIdentity === event.relationship,
						);
						const properties = written === undefined ? null : event.properties(written);
						if (properties !== null) {
							recordedChanges.push({
								kind: "create",
								itemIdentity: event.itemIdentity,
								...(event.kernelCollection ? { kernelCollection: true } : {}),
								item: {
									properties,
									occurredAt: event.occurredAt,
									entityId: yield* prepared.entityOf(event.entity),
									eventSchemaSlug: EventSchemaSlug.make(event.eventSchemaSlug),
								},
							});
						}
					}
					if (recordedChanges.length > 0) {
						const recordedEvents = yield* eventMutations.prepare(transaction, {
							userId,
							command,
							changes: recordedChanges,
							verbatimIdentities: options.events?.verbatimIdentities === true,
						});
						recorded.push({
							command,
							prepared: recordedEvents,
							validated: unchangedPolicies(
								yield* eventPolicyItems(recordedEvents),
								recordedEvents.references,
							),
						});
					}
				}
				for (const { group, batches: groupBatches } of groups) {
					if (!group.main) {
						yield* eventMutations.lockPreparedChanges({
							userId: group.userId,
							batches: groupBatches,
						});
					}
				}
				const eventBatch = { command, identity: ["events"], resource: "event" as const };
				yield* planner.prepareBatch(transaction, {
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
					const persistedGroups =
						recorded.length === 0 || userId === null
							? groups
							: [
									...groups.filter(({ group }) => !group.main),
									{
										batches: [...main, ...recorded],
										group: { userId, command, main: true, changes: [] },
									},
								];
					for (const { group, batches: groupBatches } of persistedGroups) {
						const work = yield* eventMutations.persistBatches(transaction, {
							batchIndexOffset,
							batch: eventBatch,
							userId: group.userId,
							batches: groupBatches,
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
					: persisted.pipe(Effect.catchTag("EventReferenceUnavailable", eventReferenceBadRequest));
				dispatch.push(...written.dispatch);
				dispatch.push(...(yield* planner.planBatch(transaction, eventBatch)));
				const root = rootId === undefined ? undefined : saved.entities[0]?.entity;
				const committed: CommittedChanges = {
					events: written.results,
					...(root === undefined ? {} : { entityId: root.id }),
				};
				return {
					dispatch,
					committed,
					entities: saved.entities,
					relationships: relationshipResults,
				};
			});
			/**
			 * Writes the prepared changes with their validated policies: the settings patch, source writes,
			 * ensures, entity deletes, then the rest of each clear and merge. An independent commit's bad
			 * request fails every create but those whose outcome stands.
			 */
			const writePrepared = Effect.fnUntraced(function* (
				prepared: PreparedChanges,
				transaction: WriteTransaction,
				validated: ValidatedPolicies,
			) {
				const { input, command, options, pluginRevision } = prepared;
				const batches = yield* eventBatches(prepared, validated);
				const accept = acceptRelationshipPolicies(validated.relationships);
				return yield* Effect.gen(function* () {
					if (input.settings !== undefined && pluginRevision !== null && input.userId !== null) {
						yield* settingsWriter.patchWithin(
							{
								userId: input.userId,
								values: input.settings,
								accountUserId: input.userId,
								pluginId: pluginRevision.id,
								pluginRevisionId: pluginRevision.revisionId,
							},
							transaction,
						);
					}
					const sources = yield* sourceWrites(
						prepared,
						transaction,
						batches,
						accept,
						validated.entities,
					);
					const dispatch = [...sources.dispatch];
					if (prepared.ensures) {
						for (const ensured of yield* entities.persistPreparedEnsures(
							transaction,
							prepared.ensures,
							validated.entities,
						)) {
							dispatch.push(...ensured.dispatch);
						}
					}
					const deleted: EntityId[] = [];
					for (const deletes of prepared.deletes) {
						const work = yield* entities.persistPreparedDeletes(
							transaction,
							deletes,
							validated.entities,
						);
						deleted.push(...work.deleted);
						dispatch.push(...work.dispatch);
					}
					const cleared = [];
					for (const clear of prepared.clears) {
						const work = yield* clear.write(transaction, accept);
						cleared.push(work.result);
						dispatch.push(...work.dispatch);
					}
					const merged = [];
					for (const merge of prepared.merges) {
						const work = yield* merge.write(transaction, accept);
						merged.push(work.result);
						dispatch.push(...work.dispatch);
					}
					if (sources.entities.length > 0) {
						dispatch.push(...(yield* entities.planEntityBatch(transaction, entityBatch(command))));
					}
					const outcomes =
						options.events?.independent === true
							? sortedOutcomes([
									...batches.kept,
									...sources.committed.events.flatMap(({ eventId, itemIdentity }) =>
										prepared.creates.has(itemIdentity)
											? [
													{
														eventId,
														status: "written" as const,
														index: createIndex(prepared, itemIdentity),
													},
												]
											: [],
									),
								])
							: [];
					return {
						dispatch,
						result: {
							merged,
							cleared,
							deleted,
							outcomes,
							signals: [],
							entities: sources.entities,
							committed: sources.committed,
							relationships: sources.relationships,
						} satisfies CommitResult,
					};
				}).pipe(Effect.catchTag("EventBadRequest", rejectCreates(options, batches.kept)));
			});
			const apply = Effect.fnUntraced(function* <A, Refusal = never>(
				input: Changes,
				command: DomainLifecycleCommand,
				writer: Writer,
				receipt: CommitReceipt<CommitResult, A>,
				options: CommitOptions<Refusal>,
			) {
				const script = writer.kind === "script" ? writer : null;
				const pluginRevision = script?.authority.pluginRevision ?? null;
				const pluginId = pluginRevision?.id ?? null;
				const { precondition } = options;
				const upserted = new Set(
					(input.globalEntities ?? []).map((item) =>
						upsertedKey(item.entitySchema.slug, item.externalId, item.provider.providerId),
					),
				);
				const unresolved = (input.globalRelationships ?? [])
					.flatMap(globalReferences)
					.find(
						(reference) =>
							reference.kind === "upserted" &&
							!upserted.has(
								upsertedKey(
									reference.entitySchema.slug,
									reference.externalId,
									reference.providerId,
								),
							),
					);
				if (unresolved) {
					return yield* new ChangeSetRejected({
						part: "globalRelationships",
						message: "A global relationship names an entity the change set does not upsert",
					});
				}
				const preparation = new WritePreparation();
				const prepared = yield* prepareChanges(
					preparation,
					input,
					command,
					pluginRevision,
					options,
				);
				const scope =
					input.userId === null
						? ({ scope: "global" } as const)
						: ({ scope: "user", userId: input.userId } as const);
				const globalWrites = Effect.fnUntraced(function* (transaction: WriteTransaction) {
					const dispatch: LifecycleDispatchPlan[] = [];
					const saved: Array<CommitResult["entities"][number]> = [];
					const upsertedIds = new Map<string, EntityId>();
					const globalEntities = input.globalEntities ?? [];
					if (globalEntities.length > 0) {
						const items: Array<
							{ readonly itemIdentity: string } & Parameters<
								typeof entities.persistPlannedProviderUpserts
							>[1]["items"][number]
						> = [];
						for (const item of globalEntities) {
							const itemIdentity =
								item.itemIdentity ??
								`global-entity:${upsertKey(item.entitySchema.slug, item.externalId)}`;
							items.push({
								...scope,
								itemIdentity,
								name: item.name,
								externalId: item.externalId,
								properties: item.properties,
								entitySchema: item.entitySchema,
								providerId: item.provider.providerId,
								updateExisting: item.provider.updateExisting,
								populatedAt:
									item.populatedAt === null
										? null
										: DateTime.toDate(DateTime.makeUnsafe(item.populatedAt)),
								...(item.preservePopulatedAt ? { preservePopulatedAt: true } : {}),
								lifecycle: options.entities?.verbatimIdentities
									? { ...command, itemIdentity }
									: itemCommand(command, itemIdentity),
							});
						}
						const work = yield* entities.persistPlannedProviderUpserts(transaction, {
							items,
							batch: { command, identity: ["global-entities"] },
						});
						for (const [index, item] of items.entries()) {
							const result = work.results[index];
							if (!result) {
								return yield* Effect.die("A global entity upsert is missing its result");
							}
							upsertedIds.set(
								upsertedKey(item.entitySchema.slug, item.externalId, item.providerId),
								result.entity.id,
							);
							saved.push({ entity: result.entity, itemIdentity: item.itemIdentity });
						}
						dispatch.push(...work.dispatch);
					}
					const resolve = (reference: GlobalEntityReference) => {
						if (reference.kind === "existing") {
							return Effect.succeed(reference.entityId);
						}
						const id = upsertedIds.get(
							upsertedKey(reference.entitySchema.slug, reference.externalId, reference.providerId),
						);
						return id === undefined
							? Effect.die("A resolved global relationship endpoint has no upserted entity")
							: Effect.succeed(id);
					};
					const groups = yield* Effect.forEach(input.globalRelationships ?? [], (group) =>
						Effect.gen(function* () {
							return {
								...(group.paging ? { paging: group.paging } : {}),
								...(group.preserveExisting ? { preserveExisting: true } : {}),
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
						const work = yield* relationships.persistPlannedReconciliation(
							transaction,
							groups,
							command,
							scope,
						);
						dispatch.push(...work.dispatch);
					}
					return { dispatch, entities: saved };
				});
				const writeAll = Effect.fnUntraced(function* (
					transaction: WriteTransaction,
					validated: ValidatedPolicies,
				) {
					const written = yield* writePrepared(prepared, transaction, validated);
					const dispatch = [...written.dispatch];
					const global = yield* globalWrites(transaction);
					dispatch.push(...global.dispatch);
					if (input.population) {
						yield* entities.persistPopulation(
							transaction,
							{
								claims: input.population.claims ?? [],
								relatedPopulated: input.population.relatedPopulated ?? [],
							},
							command,
							input.userId,
						);
					}
					for (const [index, trigger] of (input.triggers ?? []).entries()) {
						yield* writeChecks.check(command, trigger.owner, input.userId, transaction);
						dispatch.push(
							...(yield* planner.planChange(
								{
									trigger: yield* lifecycleTrigger(
										itemCommand(command, `trigger:${index}`),
										trigger.scopeUserId,
										trigger.change,
									),
								},
								transaction,
							)),
						);
					}
					const planned: Array<CommitResult["signals"][number]> = [];
					for (const signal of input.signals ?? []) {
						const plan = yield* signals.planSignal(
							{
								reference: signal.reference,
								principal: signal.principal,
								properties: signal.properties,
								command: itemCommand(command, signal.itemIdentity),
								...(signal.subjectEntityId === undefined
									? {}
									: { subjectEntityId: signal.subjectEntityId }),
							},
							transaction,
						);
						planned.push({ plan, itemIdentity: signal.itemIdentity });
						dispatch.push(toLifecycleDispatchPlan(plan));
					}
					if (script) {
						for (const notice of script.authority.notifications) {
							yield* notifications.admitMessageWithin(notice, transaction);
						}
					}
					if (input.folds && pluginId !== null) {
						yield* folds.request(
							{
								pluginId,
								mode: input.folds.mode,
								entityIds: input.folds.entityIds,
								userId: input.folds.scope === "user" ? input.userId : null,
							},
							transaction,
						);
					}
					const result: CommitResult = {
						...written.result,
						signals: planned,
						entities: [...written.result.entities, ...global.entities],
					};
					if (precondition && wroteAnything(result)) {
						yield* precondition.written(result);
					}
					return { dispatch, value: yield* receipt.record(result) };
				});
				const settled = (
					value: A,
				): { readonly value: A; readonly dispatch: ReadonlyArray<LifecycleDispatchPlan> } => ({
					value,
					dispatch: [],
				});
				const unchecked = (writes: WriteTransaction) =>
					Effect.map(settledByReceipt(receipt, writes, precondition), (stopped) =>
						stopped === null || "refused" in stopped ? stopped : settled(stopped.value),
					);
				const transaction = <X, E, R>(
					work: (transaction: WriteTransaction) => Effect.Effect<X, E, R>,
				) =>
					eventMutations.transaction(
						work,
						command.causation.lane === "background" || options.queueFolds ? "queue" : "eager",
						preparation,
					);
				// Every catalog read and write check of a commit transaction follows its catalog lock, so they
				// share one current reading of the user's plugins.
				const lockCatalog = Effect.fnUntraced(function* (writes: WriteTransaction) {
					if (input.settings !== undefined && pluginRevision !== null && input.userId !== null) {
						yield* settingsWriter.lockForPatch(input.userId, writes);
					}
					if (precondition?.lock) {
						yield* precondition.lock(writes);
					}
					yield* planner.lockCatalog([input.userId], writes);
				});
				const commitInTransactions = Effect.gen(function* () {
					const started = yield* transaction((writes) =>
						Effect.gen(function* () {
							yield* lockCatalog(writes);
							const stopped = yield* unchecked(writes);
							if (stopped !== null) {
								return { committed: stopped, kind: "committed" as const };
							}
							const planned = yield* planPolicies(prepared, writes);
							if (
								unmatchedPolicies([
									...planned.events.flatMap(({ chunks }) => chunks),
									...planned.relationships,
									...planned.entities,
								])
							) {
								return {
									kind: "committed" as const,
									committed: yield* writeAll(writes, yield* validatePolicies(prepared, planned)),
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
					const validated = yield* validatePolicies(prepared, started.planned);
					return yield* transaction((writes) =>
						Effect.gen(function* () {
							yield* lockCatalog(writes);
							const stopped = yield* unchecked(writes);
							if (stopped !== null) {
								return stopped;
							}
							return yield* writeAll(writes, validated);
						}),
					).pipe(
						Effect.catchTags({
							DatabaseSessionStateError: Effect.die,
							LifecyclePersistenceError: Effect.die,
						}),
					);
				});
				const committed = yield* commitInTransactions.pipe(
					Effect.catchTag("EventCreateRejected", (rejection) =>
						inTransaction(
							Effect.gen(function* () {
								const stored = yield* receipt.load;
								return settled(
									stored ??
										(yield* receipt.record({
											...emptyCommitResult,
											outcomes: rejectedOutcomes(rejection, prepared.creates.size),
										})),
								);
							}),
						),
					),
				);
				if ("refused" in committed) {
					return yield* Effect.fail(committed.refused);
				}
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
			const commitKernel = <A, E>(
				input: Changes,
				command: DomainLifecycleCommand,
				receipt: CommitReceipt<CommitResult, A>,
				options: CommitOptions<E>,
			) =>
				Effect.gen(function* () {
					const part = scriptOnlyPart(input);
					if (part !== undefined) {
						return yield* new ChangeSetRejected({
							part,
							message: `${part} requires a script writer`,
						});
					}
					return yield* rematchOnce(
						retryWhileExpectedHolds(
							input,
							apply(input, command, { kind: "kernel" }, receipt, options),
						),
					);
				});
			/** Commits a kernel writer's changes; script authority checks do not apply. */
			const commit = Effect.fn("ChangeSets.commit")(function* <E = never>(
				input: Changes,
				command: DomainLifecycleCommand,
				options: CommitOptions<E> = {},
			) {
				return yield* commitKernel(
					input,
					command,
					unrecorded(Function.identity<CommitResult>),
					options,
				);
			});
			/**
			 * Commits a kernel writer's changes at most once against the receipt's durable state. A recorded
			 * result or a failed precondition ends the commit before preparation, and again inside the
			 * transaction, where no write precedes it.
			 */
			const commitOnce = Effect.fn("ChangeSets.commitOnce")(function* <A, E = never>(
				input: Changes,
				command: DomainLifecycleCommand,
				receipt: CommitReceipt<CommitResult, A>,
				options: CommitOptions<E> = {},
			) {
				const settled =
					options.precondition === undefined && receipt.peek
						? Effect.map(receipt.peek, (value) => (value === null ? null : { value }))
						: inTransaction(
								Effect.suspend(() => {
									const writes = new WriteTransaction();
									return Effect.andThen(
										options.precondition?.lock?.(writes) ?? Effect.void,
										settledByReceipt(receipt, writes, options.precondition),
									);
								}),
							);
				const stopped = yield* settled;
				if (stopped === null) {
					return yield* commitKernel(input, command, receipt, options);
				}
				if ("refused" in stopped) {
					return yield* Effect.fail(stopped.refused);
				}
				return stopped.value;
			});
			/** Commits independent event creates once per key, held by the account's idempotency key. */
			const commitEventsKeyed = Effect.fn("ChangeSets.commitEventsKeyed")(function* (
				input: Changes & { readonly userId: UserId },
				command: DomainLifecycleCommand,
				key: string,
				options: CommitOptions & {
					readonly events: { readonly independent: true; readonly verbatimIdentities?: true };
				},
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
				command: ScriptLifecycleCommand,
				receipt: CommitReceipt<CommittedChanges, A>,
			) {
				if (input === undefined || isEmptyChangeSet(input)) {
					return yield* inTransaction(
						Effect.gen(function* () {
							return (yield* receipt.load) ?? (yield* receipt.record(emptyCommitResult.committed));
						}),
					);
				}
				const stored = yield* receipt.peek ?? inTransaction(receipt.load);
				if (stored !== null) {
					return stored;
				}
				const principal = command.writeContext;
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
				return yield* rematchOnce(
					apply(
						fromScriptChangeSet(input, userId, pluginRevision?.id ?? null, principal.providerId),
						command,
						{ principal, authority, kind: "script" },
						{ ...receipt, record: (result) => receipt.record(result.committed) },
						{},
					),
				);
			});
			return { commit, commitOnce, commitScript, commitEventsKeyed };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
