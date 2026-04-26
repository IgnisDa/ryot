import { Schema } from "effect";

const ResolvedImportEntityRef = Schema.Struct({
	sourceLabel: Schema.String,
	kind: Schema.Literal("resolved"),
	scriptSlug: Schema.NonEmptyString,
	externalId: Schema.NonEmptyString,
	entitySchemaSlug: Schema.NonEmptyString,
});

const UnresolvedImportEntityRef = Schema.Struct({
	sourceLabel: Schema.String,
	kind: Schema.Literal("unresolved"),
	identifierType: Schema.NonEmptyString,
	identifierValue: Schema.NonEmptyString,
	entitySchemaSlug: Schema.NonEmptyString,
});

export const ImportEntityRef = Schema.Union(ResolvedImportEntityRef, UnresolvedImportEntityRef);

export type ImportEntityRef = typeof ImportEntityRef.Type;

export const importEntityRefKey = (ref: ImportEntityRef): string =>
	ref.kind === "resolved"
		? `${ref.entitySchemaSlug}|${ref.scriptSlug}|${ref.externalId}`
		: `${ref.entitySchemaSlug}|${ref.identifierType}|${ref.identifierValue}`;

export const ImportMediaEvent = Schema.Struct({
	occurredAt: Schema.NonEmptyString,
	eventSchemaSlug: Schema.NonEmptyString,
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type ImportMediaEvent = typeof ImportMediaEvent.Type;

const ImportCollectionMembership = Schema.Struct({ collectionName: Schema.NonEmptyString });

export const ImportMediaEntityGroup = Schema.Struct({
	entityRef: ImportEntityRef,
	events: Schema.Array(ImportMediaEvent),
	itemIndex: Schema.optional(Schema.Number),
	ownershipProvider: Schema.optional(Schema.String),
	collectionMemberships: Schema.Array(ImportCollectionMembership),
});

export type ImportMediaEntityGroup = typeof ImportMediaEntityGroup.Type;
