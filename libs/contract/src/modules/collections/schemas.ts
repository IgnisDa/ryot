import { Schema } from "effect";

import {
	EntityId,
	EntitySchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
} from "../../schema/brands";

export const CollectionResponse = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaSlug: EntitySchemaSlug,
	externalId: Schema.NullOr(Schema.String),
	providerId: Schema.NullOr(SandboxProviderId),
});

export type CollectionResponse = typeof CollectionResponse.Type;

const MembershipRelationship = Schema.Struct({
	id: RelationshipId,
	createdAt: Schema.String,
	properties: Schema.Unknown,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	relationshipSchemaSlug: RelationshipSchemaSlug,
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
	entityId: EntityId,
	collectionId: EntityId,
	properties: Schema.optional(Schema.Unknown),
});

export type CreateMembershipBody = typeof CreateMembershipBody.Type;

export const DeleteMembershipBody = Schema.Struct({
	entityId: EntityId,
	collectionId: EntityId,
});

export type DeleteMembershipBody = typeof DeleteMembershipBody.Type;
