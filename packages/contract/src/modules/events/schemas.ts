import { Schema } from "effect";

import {
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EventId,
	EventSchemaSlug,
} from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { AutomationWarning } from "../automations/lifecycle";

export const ListedEvent = Schema.Struct({
	id: EventId,
	entityId: EntityId,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	eventSchemaName: Schema.String,
	eventSchemaSlug: EventSchemaSlug,
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
	strictStruct({ runId: AutomationRunId, code: Schema.Literal("policy-execution-failed") }),
	strictStruct({
		triggerId: AutomationTriggerId,
		code: Schema.Literal("automation-limit-reached"),
	}),
	strictStruct({ code: Schema.Literal("entity-id-required") }),
	strictStruct({ code: Schema.Literal("invalid-properties") }),
	strictStruct({ code: Schema.Literal("event-schema-slug-required") }),
	strictStruct({ entityId: EntityId, code: Schema.Literal("entity-not-found") }),
	strictStruct({ entityId: EntityId, code: Schema.Literal("session-entity-not-found") }),
	strictStruct({ occurredAt: Schema.String, code: Schema.Literal("invalid-occurred-at") }),
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
	strictStruct({ eventId: EventId, index: Schema.Number, status: Schema.Literal("written") }),
	strictStruct({
		index: Schema.Number,
		reason: Schema.String,
		status: Schema.Literal("skipped_by_policy"),
	}),
]);

export type EventCreateItemOutcome = typeof EventCreateItemOutcome.Type;

export const CreateEventsResponse = strictStruct({
	count: Schema.Number,
	warnings: Schema.Array(AutomationWarning),
	outcomes: Schema.Array(EventCreateItemOutcome),
	failure: Schema.NullOr(strictStruct({ index: Schema.Number, reason: EventCreateFailureReason })),
});

export type CreateEventsResponse = typeof CreateEventsResponse.Type;

export class EventsInternalError extends Schema.TaggedError<EventsInternalError>()(
	"EventsInternalError",
	{ reason: strictStruct({ code: Schema.Literal("unexpected-error") }) },
) {}
