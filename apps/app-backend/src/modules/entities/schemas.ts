import { Schema } from "effect";

import { EntityId, EntitySchemaId, RemoteImageUrl, SandboxScriptId } from "#lib/schema/brands";

const S3ImageKey = Schema.String.pipe(
	Schema.filter((value) => (value.trim().length > 0 ? true : "Entity image s3 key is required")),
);

export const EntityImage = Schema.Union(
	Schema.Struct({ key: S3ImageKey, type: Schema.Literal("s3") }).pipe(
		Schema.annotations({ identifier: "EntityS3Image", title: "Entity S3 Image" }),
	),
	Schema.Struct({ url: RemoteImageUrl, type: Schema.Literal("remote") }).pipe(
		Schema.annotations({ identifier: "EntityRemoteImage", title: "Entity Remote Image" }),
	),
);

export type EntityImage = typeof EntityImage.Type;

export const ListedEntity = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaId: EntitySchemaId,
	image: Schema.NullOr(EntityImage),
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(Schema.String),
	sandboxScriptId: Schema.NullOr(SandboxScriptId),
});

export type ListedEntity = typeof ListedEntity.Type;

export const TranslationStatus = Schema.Literal("pending", "ready", "none");

export type TranslationStatus = typeof TranslationStatus.Type;

export const EntityDetail = Schema.Struct({
	...ListedEntity.fields,
	translationStatus: TranslationStatus,
});

export type EntityDetail = typeof EntityDetail.Type;

export const CreateEntityBody = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	entitySchemaId: EntitySchemaId,
	externalId: Schema.optional(Schema.String),
	sandboxScriptId: Schema.optional(SandboxScriptId),
	image: Schema.optional(Schema.NullOr(EntityImage)),
});

export type CreateEntityBody = typeof CreateEntityBody.Type;
