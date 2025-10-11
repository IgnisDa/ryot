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

export type ImportMediaEvent = {
	occurredAt: string;
	eventSchemaSlug: string;
	properties: Record<string, unknown>;
};

export type ImportCollectionMembership = { collectionName: string };

export type ImportMediaEntityGroup = {
	itemIndex?: number;
	entityRef: ImportEntityRef;
	ownershipProvider?: string;
	events: ImportMediaEvent[];
	collectionMemberships: ImportCollectionMembership[];
};
