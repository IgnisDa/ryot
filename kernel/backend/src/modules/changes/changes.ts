import type { AutomationChangePayload } from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	ChangeSet,
	ChangeSetEntity,
	ChangeSetEntityUpdate,
} from "@ryot-app/contract/modules/changes/change-set";
import type {
	ChangeSetEntityReference,
	ChangeSetGlobalEntityReference,
} from "@ryot-app/contract/modules/changes/references";
import type { EventCreate } from "@ryot-app/contract/modules/events/mutations";
import type { CreateEventItem } from "@ryot-app/contract/modules/events/schemas";
import {
	type DefinitionOwner,
	definitionOwner,
	type EntitySchemaReference,
	type RelationshipSchemaReference,
	type SignalSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	type EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	type RelationshipId,
	RelationshipSchemaSlug,
	type SandboxProviderId,
	SignalSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { EmitSignalInput } from "#modules/automations/signal-service";
import type { EntityMatch } from "#modules/entities/service";
import type { EventMutation } from "#modules/events/mutations";
import type {
	ReconcileGlobalRelationshipGroup,
	RelationshipWriteResult,
} from "#modules/relationships/mutation-support";

/** A user entity: the root, an existing one, or one this change set creates or references by `key`. */
export type EntityReference =
	ChangeSetEntityReference | { readonly key: string; readonly kind: "keyed" };
/** One event change a writer commits: a create by reference, or a kernel event mutation. */
export type EventChange<Reference = EntityReference> =
	EventCreateChange<Reference> | Exclude<EventMutation, { readonly kind: "create" }>;
/** An existing entity, or one this change set upserts under `providerId`. */
export type GlobalEntityReference =
	| Extract<ChangeSetGlobalEntityReference, { readonly kind: "existing" }>
	| ({ readonly providerId?: SandboxProviderId } & OwnedEntity<
			Extract<ChangeSetGlobalEntityReference, { readonly kind: "upserted" }>
	  >);
/**
 * An event create recorded by the relationship change with item identity `relationship`, with the
 * properties `properties` gives for what it wrote, or none for null. It runs no before policies.
 */
export type RelationshipEvent = KernelCollection & {
	readonly occurredAt: string;
	readonly itemIdentity: string;
	readonly relationship: string;
	readonly entity: EntityReference;
	readonly eventSchemaSlug: string;
	readonly properties: (
		written: RelationshipWriteResult,
	) => null | Readonly<Record<string, unknown>>;
};
/**
 * What one writer commits, with owner-qualified schema references. Kernel writers build it directly;
 * script change sets reach it only through `fromScriptChangeSet`, which qualifies every schema with the
 * writing plugin. Entity creates, updates and deletes, and global upserts, write in the user's scope
 * or, without a user, the global scope.
 */
export type Changes = {
	readonly userId: null | UserId;
	readonly folds?: ChangeSet["folds"];
	readonly settings?: ChangeSet["settings"];
	readonly entity?: EntityWrite<ChangeSetEntity>;
	readonly signals?: ReadonlyArray<SignalEmission>;
	readonly globalEntities?: ReadonlyArray<GlobalEntityUpsert>;
	readonly globalRelationships?: ReadonlyArray<OwnedGlobalRelationshipGroup>;
	readonly events?: Omit<Part<"events">, "changes"> & {
		readonly changes: ReadonlyArray<EventChange>;
	};
	/** Changes recorded for `scopeUserId`'s hooks under the writer's authority over `owner` (kernel writers only). */
	readonly triggers?: ReadonlyArray<{
		readonly owner: DefinitionOwner;
		readonly scopeUserId: null | UserId;
		readonly change: AutomationChangePayload;
	}>;
	/**
	 * Related-population bookkeeping on existing provider entities, at the command's time (kernel
	 * writers only): `claims` start each entity's related population under `generation`, and
	 * `relatedPopulated` stamps each entity's related level complete.
	 */
	readonly population?: {
		readonly relatedPopulated?: ReadonlyArray<EntityId>;
		readonly claims?: ReadonlyArray<{ readonly entityId: EntityId; readonly generation: string }>;
	};
	readonly relationships?: {
		readonly events?: ReadonlyArray<RelationshipEvent>;
		readonly updates?: ReadonlyArray<OwnedRelationship<Keyed<RelationshipWrite>>>;
		readonly ensures?: ReadonlyArray<OwnedRelationship<Keyed<RelationshipWrite>>>;
		readonly deletes?: ReadonlyArray<OwnedRelationship<Keyed<RelationshipDelete>>>;
		readonly upserts?: ReadonlyArray<OwnedRelationship<Keyed<RelationshipUpsert>>>;
		readonly deletesById?: ReadonlyArray<{
			readonly itemIdentity?: string;
			readonly relationshipId: RelationshipId;
		}>;
	};
	readonly entities?: {
		readonly creates?: ReadonlyArray<EntityCreate>;
		readonly ensures?: ReadonlyArray<OwnedEntity<NonNullable<EntityParts["ensures"]>[number]>>;
		readonly clears?: ReadonlyArray<UserDataEntity<NonNullable<EntityParts["clears"]>[number]>>;
		readonly merges?: ReadonlyArray<UserDataEntity<NonNullable<EntityParts["merges"]>[number]>>;
		readonly updates?: ReadonlyArray<
			EntityWrite<ChangeSetEntityUpdate> & { readonly populatedAt?: null | string }
		>;
		readonly deletes?: ReadonlyArray<
			{ readonly preserveHistory?: true } & OwnedEntity<NonNullable<EntityParts["deletes"]>[number]>
		>;
		/** Existing entities the change set names by `key`; each is kept unchanged. */
		readonly references?: ReadonlyArray<{
			readonly key: string;
			readonly entityId: EntityId;
			readonly itemIdentity?: string;
			readonly entitySchema: EntitySchemaReference;
		}>;
	};
};
type EntityParts = Part<"entities">;
type RelationshipParts = Part<"relationships">;
/** A part `CollectionsService` builds, which a plugin writer may commit under the kernel collection schemas. */
type KernelCollection = { readonly kernelCollection?: true };
type Part<K extends keyof ChangeSet> = NonNullable<ChangeSet[K]>;
type GlobalRelationshipGroup = Part<"globalRelationships">[number];
/** A kernel writer's update or ensure, which replaces the properties it writes. */
type RelationshipWrite = Omit<RelationshipUpsert, "propertiesMode">;
type RelationshipDelete = NonNullable<RelationshipParts["deletes"]>[number];
/** Kernel writers pass properties that the write validates against the relationship schema. */
type UnknownProperties<T> = Omit<T, "properties"> & { readonly properties: unknown };
type ExpectedTarget<T extends { readonly target: unknown }> = {
	readonly target: UnknownExpected<T["target"]>;
};
type RelationshipUpsert = KernelCollection &
	UnknownProperties<NonNullable<RelationshipParts["upserts"]>[number]>;
type OwnedEntity<T extends { readonly entitySchemaSlug: string }> = Omit<T, "entitySchemaSlug"> & {
	readonly entitySchema: EntitySchemaReference;
};

/** Kernel writers pass properties and update baselines that the write validates. */
type EntityWrite<T extends { readonly target: unknown; readonly entitySchemaSlug: string }> =
	ExpectedTarget<T> & Omit<UnknownProperties<OwnedEntity<T>>, "target">;
/** A clear or merge of user data; a kernel writer's `null` schema accepts the entity's own. */
type UserDataEntity<T extends { readonly entitySchemaSlug: string }> = Omit<
	OwnedEntity<T>,
	"entitySchema"
> & { readonly entitySchema: null | EntitySchemaReference };

type OwnedRelationship<T extends { readonly relationshipSchemaSlug: string }> = Omit<
	T,
	"relationshipSchemaSlug"
> & { readonly relationshipSchema: RelationshipSchemaReference };

type UnknownExpected<T> = T extends {
	readonly expected: infer E extends { readonly properties: unknown };
}
	? Omit<T, "expected"> & { readonly expected: UnknownProperties<E> }
	: T;

type Keyed<T extends { readonly source: unknown; readonly target: unknown }> = Omit<
	T,
	"source" | "target"
> & { readonly source: EntityReference; readonly target: EntityReference };

/** A signal emitted by `principal`; its trigger derives from `itemIdentity`. */
type SignalEmission = Pick<EmitSignalInput, "principal" | "properties"> & {
	readonly itemIdentity: string;
	readonly subjectEntityId?: EntityId;
	readonly reference: SignalSchemaReference;
};

/** An event create naming its entity and session by reference, with properties the write validates. */
type EventCreateChange<Reference = EntityReference> = Omit<
	EventCreate,
	"entity" | "session" | "properties"
> & {
	readonly entity: Reference;
	readonly properties: unknown;
	readonly session?: undefined | Reference;
};

/**
 * A provider entity upsert. An existing entity its external ID names is updated when `updateExisting`
 * or while it is an unpopulated stub, and kept otherwise; `preservePopulatedAt` keeps a stored
 * `populatedAt`.
 */
type GlobalEntityUpsert = UnknownProperties<OwnedEntity<Part<"globalEntities">[number]>> & {
	readonly itemIdentity?: string;
	readonly preservePopulatedAt?: true;
	readonly provider: { readonly updateExisting: boolean; readonly providerId: SandboxProviderId };
};

/**
 * A kernel writer's entity create, which the change set's other parts may reference by `key`. With a
 * provider it keeps the entity its external ID already names unless `updateExisting`; with a `match`
 * it keeps the entity the match finds under its schema, and fails when none is found and the match
 * is `required`.
 */
type EntityCreate = KernelCollection &
	UnknownProperties<OwnedEntity<Omit<ChangeSetEntity, "target">>> & {
		readonly key?: string;
		readonly externalId?: string;
		readonly populatedAt?: null | string;
		readonly match?: EntityMatch & { readonly required: boolean };
		readonly provider?: {
			readonly updateExisting: boolean;
			readonly providerId: SandboxProviderId;
		};
	};

type OwnedGlobalRelationshipGroup = Pick<
	ReconcileGlobalRelationshipGroup,
	"paging" | "preserveExisting"
> &
	OwnedRelationship<Omit<GlobalRelationshipGroup, "selector" | "relationships">> & {
		readonly relationships: ReadonlyArray<
			{ readonly source: GlobalEntityReference; readonly target: GlobalEntityReference } & Omit<
				UnknownProperties<GlobalRelationshipGroup["relationships"][number]>,
				"source" | "target"
			>
		>;
		readonly selector:
			| { readonly type: "self"; readonly entitySchema: EntitySchemaReference }
			| ({ readonly anchor: GlobalEntityReference } & Omit<
					Extract<GlobalRelationshipGroup["selector"], { readonly type: "anchored" }>,
					"anchor"
			  >);
	};

const ownEntity =
	(owner: DefinitionOwner) =>
	<T extends { readonly entitySchemaSlug: string }>({
		entitySchemaSlug,
		...item
	}: T): OwnedEntity<T> => ({
		...item,
		entitySchema: { owner, slug: EntitySchemaSlug.make(entitySchemaSlug) },
	});

const ownRelationship =
	(owner: DefinitionOwner) =>
	<T extends { readonly relationshipSchemaSlug: string }>({
		relationshipSchemaSlug,
		...item
	}: T): OwnedRelationship<T> => ({
		...item,
		relationshipSchema: { owner, slug: RelationshipSchemaSlug.make(relationshipSchemaSlug) },
	});

/**
 * A script's change set, every schema of which belongs to the writing plugin (the kernel without one).
 * Its signals are emitted by its user, or the system without one, and its global entities upserted
 * under its provider.
 */
export const fromScriptChangeSet = (
	changeSet: ChangeSet,
	userId: null | UserId,
	pluginId: null | string,
	providerId: null | SandboxProviderId,
): Changes => {
	const owner = definitionOwner(pluginId);
	const entity = ownEntity(owner);
	const relationship = ownRelationship(owner);
	const globalReference = (reference: ChangeSetGlobalEntityReference): GlobalEntityReference =>
		reference.kind === "existing"
			? reference
			: { ...entity(reference), ...(providerId === null ? {} : { providerId }) };
	const { entities, relationships } = changeSet;
	return {
		userId,
		...(changeSet.settings === undefined ? {} : { settings: changeSet.settings }),
		...(changeSet.folds === undefined ? {} : { folds: changeSet.folds }),
		...(changeSet.signals === undefined
			? {}
			: {
					signals: changeSet.signals.map(
						({ schemaSlug, properties, discriminator, subjectEntityId }) => ({
							properties,
							itemIdentity: `signal:${discriminator}`,
							...(subjectEntityId === undefined ? {} : { subjectEntityId }),
							reference: { owner, slug: SignalSchemaSlug.make(schemaSlug) },
							principal:
								userId === null ? { kind: "system" as const } : { userId, kind: "user" as const },
						}),
					),
				}),
		...(changeSet.events === undefined ? {} : { events: changeSet.events }),
		...(changeSet.entity === undefined ? {} : { entity: entity(changeSet.entity) }),
		...(changeSet.globalEntities === undefined || providerId === null
			? {}
			: {
					globalEntities: changeSet.globalEntities.map((item) => ({
						...entity(item),
						provider: { providerId, updateExisting: false },
					})),
				}),
		...(changeSet.globalRelationships === undefined
			? {}
			: {
					globalRelationships: changeSet.globalRelationships.map((group) => ({
						...relationship(group),
						relationships: group.relationships.map((item) => ({
							...item,
							source: globalReference(item.source),
							target: globalReference(item.target),
						})),
						selector:
							group.selector.type === "self"
								? {
										type: "self" as const,
										entitySchema: {
											owner,
											slug: EntitySchemaSlug.make(group.selector.entitySchemaSlug),
										},
									}
								: { ...group.selector, anchor: globalReference(group.selector.anchor) },
					})),
				}),
		...(entities === undefined
			? {}
			: {
					entities: {
						...(entities.deletes ? { deletes: entities.deletes.map(entity) } : {}),
						...(entities.clears ? { clears: entities.clears.map(entity) } : {}),
						...(entities.ensures ? { ensures: entities.ensures.map(entity) } : {}),
						...(entities.merges ? { merges: entities.merges.map(entity) } : {}),
						...(entities.updates ? { updates: entities.updates.map(entity) } : {}),
					},
				}),
		...(relationships === undefined
			? {}
			: {
					relationships: {
						...(relationships.deletes ? { deletes: relationships.deletes.map(relationship) } : {}),
						...(relationships.upserts ? { upserts: relationships.upserts.map(relationship) } : {}),
					},
				}),
	};
};

/**
 * The event mutation `change` makes, its entity and session resolved by `entityOf`: the one translation
 * of a change set's and a fold's event changes.
 */
export const eventMutation = <Reference, E, R>(
	change: EventChange<Reference>,
	entityOf: (reference: Reference) => Effect.Effect<EntityId, E, R>,
): Effect.Effect<EventMutation, E, R> =>
	change.kind !== "create"
		? Effect.succeed(change)
		: Effect.gen(function* () {
				return {
					kind: "create" as const,
					itemIdentity: change.itemIdentity,
					item: {
						properties: change.properties,
						entityId: yield* entityOf(change.entity),
						eventSchemaSlug: EventSchemaSlug.make(change.eventSchemaSlug),
						...(change.orderAfter ? { orderAfter: change.orderAfter } : {}),
						...(change.occurredAt === undefined ? {} : { occurredAt: change.occurredAt }),
						...(change.session === undefined
							? {}
							: { sessionEntityId: yield* entityOf(change.session) }),
					},
				};
			});

/** Independent event creates of existing entities, identified as `event:<index>` unless given. */
export const eventCreateChanges = (
	userId: UserId,
	items: ReadonlyArray<CreateEventItem>,
	itemIdentities?: ReadonlyArray<string>,
): Changes & { readonly userId: UserId } => ({
	userId,
	events: {
		changes: items.map((item, index) => ({
			kind: "create" as const,
			properties: item.properties,
			eventSchemaSlug: item.eventSchemaSlug,
			itemIdentity: itemIdentities?.[index] ?? `event:${index}`,
			entity: { entityId: item.entityId, kind: "existing" as const },
			...(item.orderAfter ? { orderAfter: item.orderAfter } : {}),
			...(item.occurredAt === undefined ? {} : { occurredAt: item.occurredAt }),
			...(item.sessionEntityId === undefined
				? {}
				: { session: { kind: "existing" as const, entityId: item.sessionEntityId } }),
		})),
	},
});

/** Event changes of the user's existing events, committed together. */
export const eventChanges = (
	userId: UserId,
	changes: ReadonlyArray<EventChange>,
): Changes & { readonly userId: UserId } => ({ userId, events: { changes } });
