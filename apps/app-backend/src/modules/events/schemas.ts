import { Schema } from "effect";

export const ListedEvent = Schema.Struct({
	id: Schema.String,
	entityId: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	properties: Schema.Unknown,
	eventSchemaId: Schema.String,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	sessionEntityId: Schema.optional(Schema.String),
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
