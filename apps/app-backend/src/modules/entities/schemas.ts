import { Either, Schema } from "effect";

export const EntityImage = Schema.Union(
	Schema.Struct({ key: Schema.String, type: Schema.Literal("s3") }).pipe(
		Schema.annotations({ identifier: "EntityS3Image", title: "Entity S3 Image" }),
	),
	Schema.Struct({ url: Schema.String, type: Schema.Literal("remote") }).pipe(
		Schema.annotations({ identifier: "EntityRemoteImage", title: "Entity Remote Image" }),
	),
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

const RemoteEntityImage = Schema.Struct({
	url: RemoteImageUrl,
	type: Schema.Literal("remote"),
}).pipe(Schema.annotations({ identifier: "RemoteEntityImage", title: "Remote Entity Image" }));

const S3ImageKey = Schema.String.pipe(
	Schema.filter((value) => (value.trim().length > 0 ? true : "Entity image s3 key is required")),
);

const S3EntityImage = Schema.Struct({ key: S3ImageKey, type: Schema.Literal("s3") }).pipe(
	Schema.annotations({ identifier: "S3EntityImage", title: "S3 Entity Image" }),
);

const CreateEntityImage = Schema.Union(RemoteEntityImage, S3EntityImage);

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

export const ImportEntityBody = Schema.Struct({
	scriptId: Schema.String,
	externalId: Schema.String,
	entitySchemaId: Schema.String,
});

export const ImportEntityRunResult = Schema.Union(
	Schema.Struct({ status: Schema.Literal("pending") }).pipe(
		Schema.annotations({
			identifier: "PendingImportEntityRunResult",
			title: "Pending Import Run Result",
		}),
	),
	Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).pipe(
		Schema.annotations({
			identifier: "FailedImportEntityRunResult",
			title: "Failed Import Run Result",
		}),
	),
	Schema.Struct({ status: Schema.Literal("completed"), data: ListedEntity }).pipe(
		Schema.annotations({
			identifier: "CompletedImportEntityRunResult",
			title: "Completed Import Run Result",
		}),
	),
);
