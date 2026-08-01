import { Schema } from "effect";

import { EntityId, EventId, EventSchemaSlug } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";

export const EventCreateOrigin = Schema.Literals([
	"api",
	"sandbox",
	"import",
	"collection",
	"integration",
]);

export type EventCreateOrigin = typeof EventCreateOrigin.Type;

export const ListedEvent = Schema.Struct({
	id: EventId,
	entityId: EntityId,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	eventSchemaSlug: EventSchemaSlug,
	eventSchemaName: Schema.String,
	sessionEntityId: Schema.optional(EntityId),
	properties: Schema.Record(Schema.String, Schema.Unknown),
});

export type ListedEvent = typeof ListedEvent.Type;

export const CreateEventItem = Schema.Struct({
	entityId: EntityId,
	properties: Schema.Unknown,
	eventSchemaSlug: EventSchemaSlug,
	occurredAt: Schema.optional(Schema.String),
	sessionEntityId: Schema.optional(EntityId),
});

export type CreateEventItem = typeof CreateEventItem.Type;

export const EventCreateFailureReason = Schema.Union([
	strictStruct({ code: Schema.Literal("policy-failed") }),
	strictStruct({ code: Schema.Literal("entity-id-required") }),
	strictStruct({ code: Schema.Literal("invalid-properties") }),
	strictStruct({ code: Schema.Literal("event-schema-slug-required") }),
	strictStruct({ code: Schema.Literal("entity-not-found"), entityId: EntityId }),
	strictStruct({ code: Schema.Literal("session-entity-not-found"), entityId: EntityId }),
	strictStruct({ code: Schema.Literal("invalid-occurred-at"), occurredAt: Schema.String }),
	strictStruct({
		eventSchemaSlug: EventSchemaSlug,
		code: Schema.Literal("event-schema-not-found"),
	}),
	strictStruct({
		entityId: EntityId,
		eventSchemaSlug: EventSchemaSlug,
		code: Schema.Literal("event-schema-mismatch"),
	}),
]);

export type EventCreateFailureReason = typeof EventCreateFailureReason.Type;

export class EventCreateItemError extends Schema.TaggedError<EventCreateItemError>()(
	"EventCreateItemError",
	{ reason: EventCreateFailureReason },
) {}

export const EventCreateItemOutcome = Schema.Union([
	strictStruct({ index: Schema.Number, status: Schema.Literal("written"), eventId: EventId }),
	strictStruct({
		index: Schema.Number,
		reason: Schema.String,
		status: Schema.Literal("skipped_by_policy"),
	}),
]);

export type EventCreateItemOutcome = typeof EventCreateItemOutcome.Type;

export const CreateEventsResponse = strictStruct({
	count: Schema.Number,
	outcomes: Schema.Array(EventCreateItemOutcome),
	failure: Schema.NullOr(strictStruct({ index: Schema.Number, reason: EventCreateFailureReason })),
});

export type CreateEventsResponse = typeof CreateEventsResponse.Type;

export class EventsBadRequest extends Schema.TaggedError<EventsBadRequest>()("EventsBadRequest", {
	reason: strictStruct({ code: Schema.Literal("integration-id-required") }),
}) {}

export class EventsInternalError extends Schema.TaggedError<EventsInternalError>()(
	"EventsInternalError",
	{ reason: strictStruct({ code: Schema.Literal("unexpected-error") }) },
) {}
