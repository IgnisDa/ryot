import { Schema } from "effect";

import { BadRequest, DbError, NotFound } from "../../errors";
import { EntityId, EventId, EventSchemaId } from "../../schema/brands";

export const EventCreateOrigin = Schema.Literal(
	"api",
	"sandbox",
	"import",
	"collection",
	"integration",
);

export type EventCreateOrigin = typeof EventCreateOrigin.Type;

const BeforeTriggerAllow = Schema.Struct({ action: Schema.Literal("allow") });
const BeforeTriggerSkip = Schema.Struct({ action: Schema.Literal("skip"), reason: Schema.String });
const BeforeTriggerReplace = Schema.Struct({
	action: Schema.Literal("replace"),
	body: Schema.Struct({
		occurredAt: Schema.optional(Schema.String),
		sessionEntityId: Schema.optional(Schema.NullOr(EntityId)),
		properties: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
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

const EventCreateFailure = Schema.Struct({
	reason: Schema.Union(BadRequest, DbError, NotFound),
	index: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export const CreateEventsResponse = Schema.Struct({
	failure: Schema.optional(EventCreateFailure),
	count: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
	skipped: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type CreateEventsResponse = typeof CreateEventsResponse.Type;
