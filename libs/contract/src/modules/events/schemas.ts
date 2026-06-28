import type { JsonValue } from "@ryot/sandbox-sdk";
import { Schema } from "effect";

import { EntityId, EventId, EventSchemaId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";

export type EventTriggerMetadata = {
	inheritedProperties?: string[];
};

export const EventCreateOrigin = Schema.Literal(
	"api",
	"sandbox",
	"import",
	"collection",
	"integration",
);

export type EventCreateOrigin = typeof EventCreateOrigin.Type;

const JsonValueSchema: Schema.Schema<JsonValue, JsonValue> = Schema.suspend(() =>
	Schema.Union(
		Schema.Null,
		Schema.String,
		Schema.Number,
		Schema.Boolean,
		Schema.Array(JsonValueSchema),
		Schema.Record({ key: Schema.String, value: JsonValueSchema }),
	),
);

const BeforeTriggerAllow = Schema.Struct({ action: Schema.Literal("allow") });
const BeforeTriggerSkip = Schema.Struct({ action: Schema.Literal("skip"), reason: Schema.String });
const BeforeTriggerReplace = Schema.Struct({
	action: Schema.Literal("replace"),
	body: Schema.Struct({
		occurredAt: Schema.optional(Schema.String),
		sessionEntityId: Schema.optional(Schema.NullOr(EntityId)),
		properties: Schema.optional(Schema.Record({ key: Schema.String, value: JsonValueSchema })),
	}),
});

export const BeforeTriggerResult = Schema.Union(
	BeforeTriggerAllow,
	BeforeTriggerSkip,
	BeforeTriggerReplace,
);

export type BeforeTriggerResult = typeof BeforeTriggerResult.Type;

export const ListedEvent = Schema.Struct({
	id: EventId,
	entityId: EntityId,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	eventSchemaId: EventSchemaId,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	sessionEntityId: Schema.optional(EntityId),
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type ListedEvent = typeof ListedEvent.Type;

export const CreateEventItem = Schema.Struct({
	entityId: EntityId,
	properties: Schema.Unknown,
	eventSchemaId: EventSchemaId,
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
