import type {
	ChangeSet,
	ChangeSetEntity,
	ChangeSetEntityUpdate,
	ChangeSetGlobalEntityReference,
} from "@ryot-app/contract/modules/changes/change-set";
import type { CreateEventItem } from "@ryot-app/contract/modules/events/schemas";
import {
	type DefinitionOwner,
	definitionOwner,
	type EntitySchemaReference,
	type RelationshipSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";

import type { EventMutation } from "#modules/events/mutations";

export type EventChange = Exclude<EventMutation, { readonly kind: "create" }>;
export type GlobalEntityReference =
	| Extract<ChangeSetGlobalEntityReference, { readonly kind: "existing" }>
	| OwnedEntity<Extract<ChangeSetGlobalEntityReference, { readonly kind: "upserted" }>>;
/**
 * What one writer commits, with owner-qualified schema references. Kernel writers build it directly;
 * script change sets reach it only through `fromScriptChangeSet`, which qualifies every schema with the
 * writing plugin.
 */
export type Changes = {
	readonly userId: null | UserId;
	readonly folds?: ChangeSet["folds"];
	readonly signals?: ChangeSet["signals"];
	readonly settings?: ChangeSet["settings"];
	readonly entity?: OwnedEntity<ChangeSetEntity>;
	readonly globalRelationships?: ReadonlyArray<OwnedGlobalRelationshipGroup>;
	readonly globalEntities?: ReadonlyArray<OwnedEntity<Part<"globalEntities">[number]>>;
	readonly events?: Omit<Part<"events">, "creates" | "changes"> & {
		readonly changes: ReadonlyArray<EventChange>;
		readonly creates: ReadonlyArray<
			Omit<EventCreate, "properties"> & { readonly properties: unknown }
		>;
	};
	readonly relationships?: {
		readonly deletes?: ReadonlyArray<
			OwnedRelationship<NonNullable<RelationshipParts["deletes"]>[number]>
		>;
		readonly upserts?: ReadonlyArray<
			OwnedRelationship<NonNullable<RelationshipParts["upserts"]>[number]>
		>;
	};
	readonly entities?: {
		readonly updates?: ReadonlyArray<OwnedEntity<ChangeSetEntityUpdate>>;
		readonly deletes?: ReadonlyArray<OwnedEntity<NonNullable<EntityParts["deletes"]>[number]>>;
		readonly ensures?: ReadonlyArray<OwnedEntity<NonNullable<EntityParts["ensures"]>[number]>>;
		readonly clears?: ReadonlyArray<UserDataEntity<NonNullable<EntityParts["clears"]>[number]>>;
		readonly merges?: ReadonlyArray<UserDataEntity<NonNullable<EntityParts["merges"]>[number]>>;
	};
};
type EntityParts = Part<"entities">;
type RelationshipParts = Part<"relationships">;
type EventCreate = Part<"events">["creates"][number];
type Part<K extends keyof ChangeSet> = NonNullable<ChangeSet[K]>;
type GlobalRelationshipGroup = Part<"globalRelationships">[number];

type OwnedEntity<T extends { readonly entitySchemaSlug: string }> = Omit<T, "entitySchemaSlug"> & {
	readonly entitySchema: EntitySchemaReference;
};

/** A clear or merge of user data; a kernel writer's `null` schema accepts the entity's own. */
type UserDataEntity<T extends { readonly entitySchemaSlug: string }> = Omit<
	OwnedEntity<T>,
	"entitySchema"
> & { readonly entitySchema: null | EntitySchemaReference };

type OwnedRelationship<T extends { readonly relationshipSchemaSlug: string }> = Omit<
	T,
	"relationshipSchemaSlug"
> & { readonly relationshipSchema: RelationshipSchemaReference };

type OwnedGlobalRelationshipGroup = OwnedRelationship<
	Omit<GlobalRelationshipGroup, "selector" | "relationships">
> & {
	readonly relationships: ReadonlyArray<
		Omit<GlobalRelationshipGroup["relationships"][number], "source" | "target"> & {
			readonly source: GlobalEntityReference;
			readonly target: GlobalEntityReference;
		}
	>;
	readonly selector:
		| Extract<GlobalRelationshipGroup["selector"], { readonly type: "self" }>
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

/** A script's change set, every schema of which belongs to the writing plugin (the kernel without one). */
export const fromScriptChangeSet = (
	changeSet: ChangeSet,
	userId: null | UserId,
	pluginId: null | string,
): Changes => {
	const owner = definitionOwner(pluginId);
	const entity = ownEntity(owner);
	const relationship = ownRelationship(owner);
	const globalReference = (reference: ChangeSetGlobalEntityReference): GlobalEntityReference =>
		reference.kind === "existing" ? reference : entity(reference);
	const { entities, relationships } = changeSet;
	return {
		userId,
		...(changeSet.settings === undefined ? {} : { settings: changeSet.settings }),
		...(changeSet.folds === undefined ? {} : { folds: changeSet.folds }),
		...(changeSet.signals === undefined ? {} : { signals: changeSet.signals }),
		...(changeSet.events === undefined ? {} : { events: changeSet.events }),
		...(changeSet.entity === undefined ? {} : { entity: entity(changeSet.entity) }),
		...(changeSet.globalEntities === undefined
			? {}
			: { globalEntities: changeSet.globalEntities.map(entity) }),
		...(changeSet.globalRelationships === undefined
			? {}
			: {
					globalRelationships: changeSet.globalRelationships.map((group) => ({
						...relationship(group),
						selector:
							group.selector.type === "self"
								? group.selector
								: { ...group.selector, anchor: globalReference(group.selector.anchor) },
						relationships: group.relationships.map((item) => ({
							...item,
							source: globalReference(item.source),
							target: globalReference(item.target),
						})),
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

/** Independent event creates of existing entities, identified as `event:<index>` unless given. */
export const eventCreateChanges = (
	userId: UserId,
	items: ReadonlyArray<CreateEventItem>,
	itemIdentities?: ReadonlyArray<string>,
): Changes & { readonly userId: UserId } => ({
	userId,
	events: {
		changes: [],
		creates: items.map((item, index) => ({
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

/** Updates and deletes of the user's existing events, committed together. */
export const eventChanges = (
	userId: UserId,
	changes: ReadonlyArray<EventChange>,
): Changes & { readonly userId: UserId } => ({ userId, events: { changes, creates: [] } });
