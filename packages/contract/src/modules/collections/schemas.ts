import { Schema } from "effect";

import {
	EntityId,
	EntitySchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
} from "../../schema/brands";
import { AutomationWarning } from "../automations/lifecycle";

const CollectionBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("circular-membership") }),
	Schema.Struct({ code: Schema.Literal("membership-event-failed") }),
	Schema.Struct({ field: Schema.Literal("name"), code: Schema.Literal("name-required") }),
	Schema.Struct({
		paths: Schema.Array(Schema.Array(Schema.String)),
		code: Schema.Literal("invalid-collection-properties"),
	}),
	Schema.Struct({
		paths: Schema.Array(Schema.Array(Schema.String)),
		code: Schema.Literal("invalid-membership-schema"),
		field: Schema.Literal("membershipPropertiesSchema"),
	}),
	Schema.Struct({
		paths: Schema.Array(Schema.Array(Schema.String)),
		code: Schema.Literal("invalid-membership-properties"),
	}),
]);

const CollectionNotFoundReason = Schema.Union([
	Schema.Struct({ collectionId: EntityId, code: Schema.Literal("collection-not-found") }),
	Schema.Struct({ entityId: EntityId, code: Schema.Literal("entity-not-found") }),
	Schema.Struct({
		entityId: EntityId,
		collectionId: EntityId,
		code: Schema.Literal("membership-not-found"),
	}),
]);

export class CollectionBadRequest extends Schema.TaggedError<CollectionBadRequest>()(
	"CollectionBadRequest",
	{ reason: CollectionBadRequestReason },
) {}

export class CollectionNotFound extends Schema.TaggedError<CollectionNotFound>()(
	"CollectionNotFound",
	{ reason: CollectionNotFoundReason },
) {}

export const CollectionResponse = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaSlug: EntitySchemaSlug,
	externalId: Schema.NullOr(Schema.String),
	warnings: Schema.Array(AutomationWarning),
	providerId: Schema.NullOr(SandboxProviderId),
});

export type CollectionResponse = typeof CollectionResponse.Type;

const MembershipRelationship = Schema.Struct({
	id: RelationshipId,
	createdAt: Schema.String,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	properties: Schema.Unknown,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

export type MembershipRelationship = typeof MembershipRelationship.Type;

export const MembershipResponse = Schema.Struct({
	memberOf: MembershipRelationship,
	warnings: Schema.Array(AutomationWarning),
});

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

export const DeleteMembershipBody = Schema.Struct({ entityId: EntityId, collectionId: EntityId });

export type DeleteMembershipBody = typeof DeleteMembershipBody.Type;
