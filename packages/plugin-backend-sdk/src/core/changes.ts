import type {
	ChangeSet,
	ChangeSetEntityUpdate,
} from "@ryot-app/contract/modules/changes/change-set";
import type {
	ChangeSetEntityReference,
	ChangeSetGlobalEntityReference,
} from "@ryot-app/contract/modules/changes/references";
import type { EventDelete, EventUpdate } from "@ryot-app/contract/modules/events/mutations";
import type { EventWritePrecondition } from "@ryot-app/contract/modules/events/schemas";
import { EntityId, type EventId } from "@ryot-app/contract/schema/brands";

export type SignalChange = NonNullable<ChangeSet["signals"]>[number];
export type RelationshipUpsert = NonNullable<
	NonNullable<ChangeSet["relationships"]>["upserts"]
>[number];
export type GlobalRelationship = NonNullable<
	ChangeSet["globalRelationships"]
>[number]["relationships"][number];

export const rootEntity = { kind: "root" } as const satisfies ChangeSetEntityReference;

export const existingEntity = (entityId: EntityId) =>
	({ entityId, kind: "existing" }) as const satisfies ChangeSetEntityReference;

export const upsertedGlobalEntity = (entitySchemaSlug: string, externalId: string) =>
	({
		externalId,
		entitySchemaSlug,
		kind: "upserted",
	}) as const satisfies ChangeSetGlobalEntityReference;

/** The update target of an existing user entity, checked against the entity as the writer read it. */
export const entityUpdateTarget = (entity: {
	readonly id: string;
	readonly name: string;
	readonly updatedAt: string;
	readonly properties: ChangeSetEntityUpdate["target"]["expected"]["properties"];
}): ChangeSetEntityUpdate["target"] => ({
	kind: "update",
	entityId: EntityId.make(entity.id),
	expected: { name: entity.name, updatedAt: entity.updatedAt, properties: entity.properties },
});

/**
 * The precondition that a relationship still exists and holds the `checked` properties the writer read.
 */
export const expectedRelationshipProperties = (
	properties: NonNullable<RelationshipUpsert["expected"]>["properties"],
	checked: ReadonlyArray<string>,
): NonNullable<RelationshipUpsert["expected"]> => ({
	properties: Object.fromEntries(
		Object.entries(properties).filter(([key]) => checked.includes(key)),
	),
});

/**
 * The precondition that an event still has the fields the writer read. With `editable` it checks only
 * those properties, including which of them are absent.
 */
export const expectedEventFields = (
	event: Omit<EventWritePrecondition, "kind" | "absentProperties"> & {
		readonly absentProperties?: EventWritePrecondition["absentProperties"];
	},
	editable?: ReadonlyArray<string>,
): EventWritePrecondition => ({
	kind: "fields",
	entityId: event.entityId,
	occurredAt: event.occurredAt,
	sessionEntityId: event.sessionEntityId,
	absentProperties:
		editable === undefined
			? (event.absentProperties ?? [])
			: editable.filter((key) => !Object.hasOwn(event.properties, key)),
	properties:
		editable === undefined
			? event.properties
			: Object.fromEntries(
					Object.entries(event.properties).filter(([key]) => editable.includes(key)),
				),
});

export const updateEventChange = (
	eventId: EventId,
	patch: EventUpdate["item"]["patch"],
	expected?: EventUpdate["item"]["expected"],
): EventUpdate => ({
	kind: "update",
	itemIdentity: `update:${eventId}`,
	item: { patch, eventId, ...(expected === undefined ? {} : { expected }) },
});

export const deleteEventChange = (
	eventId: EventId,
	expected?: EventDelete["expected"],
): EventDelete => ({
	eventId,
	kind: "delete",
	itemIdentity: `delete:${eventId}`,
	...(expected === undefined ? {} : { expected }),
});
