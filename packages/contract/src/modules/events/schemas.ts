import { Schema } from "effect";

import {
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EventId,
	EventSchemaSlug,
} from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { AutomationWarning } from "../automations/lifecycle";

export const EventPropertiesPatch = strictStruct({
	remove: Schema.Array(Schema.String),
	set: Schema.Record(Schema.String, JsonValue),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(patch) =>
				(patch.remove.length > 0 || Object.keys(patch.set).length > 0) &&
				new Set(patch.remove).size === patch.remove.length &&
				patch.remove.every((key) => !Object.hasOwn(patch.set, key)),
		),
	),
);

export type EventPropertiesPatch = typeof EventPropertiesPatch.Type;

export const EventUpdatePatch = strictStruct({
	entityId: Schema.optional(EntityId),
	occurredAt: Schema.optional(Schema.String),
	properties: Schema.optional(EventPropertiesPatch),
	sessionEntityId: Schema.optional(Schema.NullOr(EntityId)),
}).pipe(Schema.check(Schema.makeFilter((patch) => Object.keys(patch).length > 0)));

export type EventUpdatePatch = typeof EventUpdatePatch.Type;

export const UpdateEventItem = strictStruct({ eventId: EventId, patch: EventUpdatePatch });

export type UpdateEventItem = typeof UpdateEventItem.Type;

export class EventBadRequest extends Schema.TaggedError<EventBadRequest>()("EventBadRequest", {
	reason: strictStruct({
		message: Schema.String,
		code: Schema.Literals([
			"automation-limit",
			"invalid-policy-transform",
			"invalid-properties",
			"mutation-conflict",
			"policy-execution-failed",
			"policy-rejected",
		]),
	}),
}) {}

export class EventNotFound extends Schema.TaggedError<EventNotFound>()("EventNotFound", {
	reason: strictStruct({ eventId: EventId, code: Schema.Literal("event-not-found") }),
}) {}

export class EventStale extends Schema.TaggedError<EventStale>()("EventStale", {
	reason: strictStruct({ eventId: EventId, code: Schema.Literal("event-stale") }),
}) {}

export const EventMutationResponse = strictStruct({
	eventId: Schema.NullOr(EventId),
	warnings: Schema.Array(AutomationWarning),
});

export type EventMutationResponse = typeof EventMutationResponse.Type;

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
	strictStruct({ eventId: EventId, index: Schema.Finite, status: Schema.Literal("written") }),
	strictStruct({
		index: Schema.Finite,
		reason: Schema.String,
		status: Schema.Literal("skipped_by_policy"),
	}),
]);

export type EventCreateItemOutcome = typeof EventCreateItemOutcome.Type;

export const CreateEventsResponse = strictStruct({
	count: Schema.Finite,
	warnings: Schema.Array(AutomationWarning),
	outcomes: Schema.Array(EventCreateItemOutcome),
	failure: Schema.NullOr(strictStruct({ index: Schema.Finite, reason: EventCreateFailureReason })),
});

export type CreateEventsResponse = typeof CreateEventsResponse.Type;

export const EventCreatePending = Schema.Union([
	strictStruct({
		operationId: Schema.String,
		writtenCount: Schema.Literal(0),
		status: Schema.Literal("accepted"),
		writesPending: Schema.Literal(true),
	}),
	strictStruct({
		operationId: Schema.String,
		writtenCount: Schema.Finite,
		writesPending: Schema.Boolean,
		status: Schema.Literal("committed-follow-up-pending"),
	}),
]);

export const EventCreateOperation = Schema.Union([
	EventCreatePending,
	strictStruct({
		operationId: Schema.String,
		result: CreateEventsResponse,
		status: Schema.Literal("completed"),
	}),
	strictStruct({
		operationId: Schema.String,
		status: Schema.Literal("failed"),
		reason: Schema.Literal("unexpected-error"),
	}),
]);

export class EventsInternalError extends Schema.TaggedError<EventsInternalError>()(
	"EventsInternalError",
	{ reason: strictStruct({ code: Schema.Literal("unexpected-error") }) },
) {}

export class EventOperationNotFound extends Schema.TaggedError<EventOperationNotFound>()(
	"EventOperationNotFound",
	{ reason: strictStruct({ code: Schema.Literal("operation-not-found") }) },
) {}
