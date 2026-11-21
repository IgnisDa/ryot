import type {
	ChangeSet,
	ChangeSetEntityReference,
	ChangeSetGlobalEntityReference,
} from "@ryot-app/contract/modules/changes/change-set";
import type { EntityId, EventId } from "@ryot-app/contract/schema/brands";

export type EventChange = NonNullable<ChangeSet["events"]>["changes"][number];
type EventUpdateChange = Extract<EventChange, { readonly kind: "update" }>;
type EventDeleteChange = Extract<EventChange, { readonly kind: "delete" }>;

export const rootEntity = { kind: "root" } as const satisfies ChangeSetEntityReference;

export const existingEntity = (entityId: EntityId) =>
	({ entityId, kind: "existing" }) as const satisfies ChangeSetEntityReference;

export const upsertedGlobalEntity = (entitySchemaSlug: string, externalId: string) =>
	({
		externalId,
		entitySchemaSlug,
		kind: "upserted",
	}) as const satisfies ChangeSetGlobalEntityReference;

export const updateEventChange = (
	eventId: EventId,
	patch: EventUpdateChange["item"]["patch"],
	expected?: EventUpdateChange["item"]["expected"],
) =>
	({
		kind: "update",
		itemIdentity: `update:${eventId}`,
		item: { patch, eventId, ...(expected === undefined ? {} : { expected }) },
	}) as const satisfies EventUpdateChange;

export const deleteEventChange = (eventId: EventId, expected?: EventDeleteChange["expected"]) =>
	({
		eventId,
		kind: "delete",
		itemIdentity: `delete:${eventId}`,
		...(expected === undefined ? {} : { expected }),
	}) as const satisfies EventDeleteChange;
