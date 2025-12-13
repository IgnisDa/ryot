import { Schema } from "effect";

import { EntityId, EntitySchemaId, SandboxScriptId } from "#lib/schema/brands";

export const ListedEntity = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaId: EntitySchemaId,
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
});

export type CreateEntityBody = typeof CreateEntityBody.Type;
