import { Schema } from "effect";

import { EntityImage } from "#modules/entities/schemas";

export const CollectionResponse = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaId: Schema.String,
	image: Schema.NullOr(EntityImage),
	externalId: Schema.NullOr(Schema.String),
	sandboxScriptId: Schema.NullOr(Schema.String),
});

export type CollectionResponse = typeof CollectionResponse.Type;

export const MembershipRelationship = Schema.Struct({
	id: Schema.String,
	createdAt: Schema.String,
	properties: Schema.Unknown,
	sourceEntityId: Schema.String,
	targetEntityId: Schema.String,
	relationshipSchemaId: Schema.String,
});

export type MembershipRelationship = typeof MembershipRelationship.Type;

export const MembershipResponse = Schema.Struct({ memberOf: MembershipRelationship });

export type MembershipResponse = typeof MembershipResponse.Type;

export const CreateCollectionBody = Schema.Struct({
	name: Schema.String,
	description: Schema.optional(Schema.String),
	membershipPropertiesSchema: Schema.optional(Schema.Unknown),
});

export type CreateCollectionBody = typeof CreateCollectionBody.Type;

export const CreateMembershipBody = Schema.Struct({
	entityId: Schema.String,
	collectionId: Schema.String,
	properties: Schema.optional(Schema.Unknown),
});

export type CreateMembershipBody = typeof CreateMembershipBody.Type;

export const DeleteMembershipBody = Schema.Struct({
	entityId: Schema.String,
	collectionId: Schema.String,
});

export type DeleteMembershipBody = typeof DeleteMembershipBody.Type;
