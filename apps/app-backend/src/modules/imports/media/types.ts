import { Schema } from "effect";

const ResolvedImportEntityRef = Schema.Struct({
	sourceLabel: Schema.String,
	kind: Schema.Literal("resolved"),
	providerSlug: Schema.NonEmptyString,
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

const ImportEntityRef = Schema.Union(ResolvedImportEntityRef, UnresolvedImportEntityRef);

export type ImportEntityRef = typeof ImportEntityRef.Type;

export const importEntityRefKey = (ref: ImportEntityRef): string =>
	ref.kind === "resolved"
		? `${ref.entitySchemaSlug}|${ref.providerSlug}|${ref.externalId}`
		: `${ref.entitySchemaSlug}|${ref.identifierType}|${ref.identifierValue}`;

const ImportMediaEventSchema = Schema.Struct({
	occurredAt: Schema.String,
	eventSchemaSlug: Schema.String,
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
	episodeLocator: Schema.optional(
		Schema.Union(
			Schema.Struct({
				type: Schema.Literal("show"),
				seasonNumber: Schema.Int.pipe(Schema.greaterThanOrEqualTo(0)),
				episodeNumber: Schema.Int.pipe(Schema.greaterThanOrEqualTo(0)),
			}),
			Schema.Struct({
				type: Schema.Literal("podcast"),
				episodeNumber: Schema.Int.pipe(Schema.greaterThanOrEqualTo(0)),
			}),
		),
	),
});

export type ImportMediaEvent = typeof ImportMediaEventSchema.Type;

const ImportCollectionMembershipSchema = Schema.Struct({
	collectionName: Schema.String,
});

export type ImportCollectionMembership = typeof ImportCollectionMembershipSchema.Type;

export const ImportMediaEntityGroupSchema = Schema.Struct({
	entityRef: ImportEntityRef,
	itemIndex: Schema.optional(Schema.Number),
	events: Schema.Array(ImportMediaEventSchema),
	ownershipProvider: Schema.optional(Schema.String),
	collectionMemberships: Schema.Array(ImportCollectionMembershipSchema),
});

export type ImportMediaEntityGroup = {
	itemIndex?: number | undefined;
	entityRef: ImportEntityRef;
	ownershipProvider?: string | undefined;
	events: ImportMediaEvent[];
	collectionMemberships: ImportCollectionMembership[];
};
