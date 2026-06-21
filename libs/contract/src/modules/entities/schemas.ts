import { Schema } from "effect";

import { EntityId, EntitySchemaSlug, SandboxScriptId } from "../../schema/brands";

export const ListedEntity = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaSlug: EntitySchemaSlug,
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

const RequiredEntitySchemaSlug = Schema.Trim.pipe(
	Schema.filter((value) => value.length > 0, { message: () => "Entity schema id is required" }),
	Schema.brand("EntitySchemaSlug"),
);

const OptionalExternalId = Schema.transform(Schema.String, Schema.UndefinedOr(Schema.String), {
	strict: true,
	encode: (value) => value ?? "",
	decode: (value) => {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	},
});

const OptionalSandboxScriptId = Schema.transform(
	Schema.String,
	Schema.UndefinedOr(SandboxScriptId),
	{
		strict: true,
		encode: (value) => value ?? "",
		decode: (value) => {
			const trimmed = value.trim();
			return trimmed.length > 0 ? SandboxScriptId.make(trimmed) : undefined;
		},
	},
);

export const CreateEntityBody = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	entitySchemaSlug: RequiredEntitySchemaSlug,
	externalId: Schema.optional(OptionalExternalId),
	sandboxScriptId: Schema.optional(OptionalSandboxScriptId),
});

export type CreateEntityBody = typeof CreateEntityBody.Type;
