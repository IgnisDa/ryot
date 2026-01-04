import { Schema } from "effect";

import { EntityId, EventId, EventSchemaSlug } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";

export const EventCreateOrigin = Schema.Literal(
	"api",
	"sandbox",
	"import",
	"collection",
	"integration",
);

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
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
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

export const EventCreateFailureReason = Schema.Union(
	strictStruct({ kind: Schema.Literal("not_found"), message: Schema.String }),
	strictStruct({ kind: Schema.Literal("bad_request"), message: Schema.String }),
);

export type EventCreateFailureReason = typeof EventCreateFailureReason.Type;

export const EventCreateItemOutcome = Schema.Union(
	strictStruct({ index: Schema.Number, status: Schema.Literal("written"), eventId: EventId }),
	strictStruct({
		index: Schema.Number,
		reason: Schema.String,
		status: Schema.Literal("skipped_by_policy"),
	}),
);

export type EventCreateItemOutcome = typeof EventCreateItemOutcome.Type;

export const CreateEventsResponse = strictStruct({
	count: Schema.Number,
	outcomes: Schema.Array(EventCreateItemOutcome),
	failure: Schema.NullOr(strictStruct({ index: Schema.Number, reason: EventCreateFailureReason })),
});

export type CreateEventsResponse = typeof CreateEventsResponse.Type;
