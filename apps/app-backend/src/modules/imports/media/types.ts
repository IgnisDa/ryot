import { Schema } from "effect";

export const ResolvedImportEntityRef = Schema.Struct({
	sourceLabel: Schema.String,
	kind: Schema.Literal("resolved"),
	scriptSlug: Schema.NonEmptyString,
	externalId: Schema.NonEmptyString,
	entitySchemaSlug: Schema.NonEmptyString,
});

export type ResolvedImportEntityRef = typeof ResolvedImportEntityRef.Type;

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

export const ImportMediaEventSchema = Schema.Struct({
	occurredAt: Schema.String,
	eventSchemaSlug: Schema.String,
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type ImportMediaEvent = {
	occurredAt: string;
	eventSchemaSlug: string;
	properties: Record<string, unknown>;
};

export const ImportCollectionMembershipSchema = Schema.Struct({
	collectionName: Schema.String,
});

export type ImportCollectionMembership = { collectionName: string };

export const ImportMediaEntityGroupSchema = Schema.Struct({
	entityRef: ImportEntityRef,
	itemIndex: Schema.optional(Schema.Number),
	events: Schema.Array(ImportMediaEventSchema),
	ownershipProvider: Schema.optional(Schema.String),
	collectionMemberships: Schema.Array(ImportCollectionMembershipSchema),
});

export type ImportMediaEntityGroup = {
	itemIndex?: number;
	entityRef: ImportEntityRef;
	ownershipProvider?: string;
	events: ImportMediaEvent[];
	collectionMemberships: ImportCollectionMembership[];
};
