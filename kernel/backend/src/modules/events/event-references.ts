import { EventBadRequest } from "@ryot-app/contract/modules/events/schemas";
import {
	type AppSchema,
	isEventReferenceProperty,
} from "@ryot-app/contract/schema/property-schema";
import { Context, Schema } from "effect";

export type ClearedEventReference = EventPropertyReference & {
	readonly referencingEventId: string;
};

export type EventPropertyReference = {
	readonly property: string;
	readonly referencedEventId: string;
};

export class EventReferenceUnavailable extends Schema.TaggedError<
	EventReferenceUnavailable,
	{ readonly brand: unique symbol }
>()("EventReferenceUnavailable", { message: Schema.String }) {}

export const eventReferenceBadRequest = (error: EventReferenceUnavailable) =>
	new EventBadRequest({ reason: { message: error.message, code: "invalid-properties" } });

/** References a transaction's deletions removed, cleared from their referrers before it settles. */
export const PendingEventReferenceClears = Context.Reference<null | Array<ClearedEventReference>>(
	"EventReferences.PendingClears",
	{ defaultValue: () => null },
);

export const eventPropertyReferences = (
	schema: AppSchema,
	properties: Readonly<Record<string, unknown>>,
): ReadonlyArray<EventPropertyReference> =>
	Object.entries(schema.fields).flatMap(([property, definition]) => {
		const value = properties[property];
		return isEventReferenceProperty(definition) && typeof value === "string"
			? [{ property, referencedEventId: value }]
			: [];
	});
