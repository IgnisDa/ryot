import { Either, Schema } from "effect";

export const EntityImage = Schema.Union(
	Schema.Struct({ key: Schema.String, type: Schema.Literal("s3") }),
	Schema.Struct({ url: Schema.String, type: Schema.Literal("remote") }),
);

export type EntityImage = typeof EntityImage.Type;

const RemoteImageUrl = Schema.String.pipe(
	Schema.filter((value) => {
		const url = Either.try(() => new URL(value.trim()));
		return Either.isRight(url) && ["http:", "https:"].includes(url.right.protocol)
			? true
			: "Entity image remote url must be a valid URL";
	}),
);

const S3ImageKey = Schema.String.pipe(
	Schema.filter((value) => (value.trim().length > 0 ? true : "Entity image s3 key is required")),
);

const CreateEntityImage = Schema.Union(
	Schema.Struct({ url: RemoteImageUrl, type: Schema.Literal("remote") }),
	Schema.Struct({ key: S3ImageKey, type: Schema.Literal("s3") }),
);

export const ListedEntity = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaId: Schema.String,
	image: Schema.NullOr(EntityImage),
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(Schema.String),
	sandboxScriptId: Schema.NullOr(Schema.String),
});

export type ListedEntity = typeof ListedEntity.Type;

export const CreateEntityBody = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	entitySchemaId: Schema.String,
	externalId: Schema.optional(Schema.String),
	sandboxScriptId: Schema.optional(Schema.String),
	image: Schema.optional(Schema.NullOr(CreateEntityImage)),
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
