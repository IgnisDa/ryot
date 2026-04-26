import { Schema } from "effect";

export type EventTriggerMetadata = {
	inheritedProperties?: string[];
};

const BeforeTriggerAllow = Schema.Struct({ action: Schema.Literal("allow") });
const BeforeTriggerSkip = Schema.Struct({ action: Schema.Literal("skip"), reason: Schema.String });
const BeforeTriggerReplace = Schema.Struct({
	action: Schema.Literal("replace"),
	body: Schema.Struct({
		occurredAt: Schema.optional(Schema.String),
		sessionEntityId: Schema.optional(Schema.NullOr(Schema.String)),
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
	id: Schema.String,
	entityId: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	eventSchemaId: Schema.String,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	sessionEntityId: Schema.optional(Schema.String),
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type ListedEvent = typeof ListedEvent.Type;

export const CreateEventItem = Schema.Struct({
	entityId: Schema.String,
	properties: Schema.Unknown,
	eventSchemaId: Schema.String,
	occurredAt: Schema.optional(Schema.String),
	sessionEntityId: Schema.optional(Schema.String),
});

export type CreateEventItem = typeof CreateEventItem.Type;

export const CreateEventsResponse = Schema.Struct({ count: Schema.Number });

export type CreateEventsResponse = typeof CreateEventsResponse.Type;
