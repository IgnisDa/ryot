import { Schema } from "effect";

export const ListedEntity = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaId: Schema.String,
	image: Schema.NullOr(Schema.String),
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(Schema.String),
	sandboxScriptId: Schema.NullOr(Schema.String),
});

export type ListedEntity = typeof ListedEntity.Type;

export const CreateEntityBody = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	entitySchemaId: Schema.String,
	image: Schema.optional(Schema.String),
	externalId: Schema.optional(Schema.String),
	sandboxScriptId: Schema.optional(Schema.String),
});

export type CreateEntityBody = typeof CreateEntityBody.Type;

export const ClearUserStateResponse = Schema.Struct({
	entityId: Schema.String,
	deletedEventsCount: Schema.Number,
	deletedRelationshipsCount: Schema.Number,
});

export type ClearUserStateResponse = typeof ClearUserStateResponse.Type;

export const ImportEntityBody = Schema.Struct({
	scriptId: Schema.String,
	externalId: Schema.String,
	entitySchemaId: Schema.String,
});

export const ImportEntityRunResult = Schema.Union(
	Schema.Struct({ status: Schema.Literal("pending") }),
	Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }),
	Schema.Struct({ status: Schema.Literal("completed"), data: ListedEntity }),
);
