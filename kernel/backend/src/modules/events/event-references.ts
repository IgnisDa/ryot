import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
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
		return definition.type === "string" &&
			definition.reference?.kind === "event-id" &&
			typeof value === "string"
			? [{ property, referencedEventId: value }]
			: [];
	});
