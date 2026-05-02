import { Schema, SchemaGetter } from "effect";

import { EntityId, EntitySchemaSlug, SandboxProviderId } from "../../schema/brands";

export const ListedEntity = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaSlug: EntitySchemaSlug,
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(Schema.String),
	providerId: Schema.NullOr(SandboxProviderId),
});

export type ListedEntity = typeof ListedEntity.Type;

export const TranslationStatus = Schema.Literals(["pending", "ready", "none"]);

export type TranslationStatus = typeof TranslationStatus.Type;

export const EntityDetail = Schema.Struct({
	...ListedEntity.fields,
	translationStatus: TranslationStatus,
});

export type EntityDetail = typeof EntityDetail.Type;

const RequiredEntitySchemaSlug = Schema.Trim.pipe(
	Schema.check(Schema.makeFilter((value) => value.length > 0)),
).pipe(Schema.decodeTo(EntitySchemaSlug));

const OptionalExternalId = Schema.String.pipe(
	Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
		decode: SchemaGetter.transform((value) => {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : undefined;
		}),
		encode: SchemaGetter.transform((value) => value ?? ""),
	}),
);

const OptionalSandboxProviderId = Schema.String.pipe(
	Schema.decodeTo(Schema.UndefinedOr(SandboxProviderId), {
		decode: SchemaGetter.transform((value) => {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : undefined;
		}),
		encode: SchemaGetter.transform((value) => value ?? ""),
	}),
);

export const CreateEntityBody = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	entitySchemaSlug: RequiredEntitySchemaSlug,
	externalId: Schema.optional(OptionalExternalId),
	providerId: Schema.optional(OptionalSandboxProviderId),
});

export type CreateEntityBody = typeof CreateEntityBody.Type;
