import { Schema } from "effect";

import {
	EntityId,
	EntitySchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
} from "../../schema/brands";
import { AutomationWarning } from "../automations/lifecycle";
import { CollectionField } from "./fields";

const CollectionBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("circular-membership") }),
	Schema.Struct({ code: Schema.Literal("membership-event-failed") }),
	Schema.Struct({ code: Schema.Literal("invalid-collection-schema") }),
	Schema.Struct({ collectionId: EntityId, code: Schema.Literal("collection-stale") }),
	Schema.Struct({
		field: Schema.Literal("name"),
		code: Schema.Literals(["name-required", "name-taken"]),
	}),
	Schema.Struct({
		paths: Schema.Array(Schema.Array(Schema.String)),
		code: Schema.Literals(["invalid-fields", "reserved-field-key"]),
	}),
	Schema.Struct({
		paths: Schema.Array(Schema.Array(Schema.String)),
		code: Schema.Literal("invalid-collection-properties"),
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

export class CollectionNotFound extends Schema.TaggedError<
	CollectionNotFound,
	{ readonly brand: unique symbol }
>()("CollectionNotFound", { reason: CollectionNotFoundReason }) {}

export class CollectionBadRequest extends Schema.TaggedError<
	CollectionBadRequest,
	{ readonly brand: unique symbol }
>()("CollectionBadRequest", { reason: CollectionBadRequestReason }) {}

export const CollectionResponse = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaPluginId: Schema.Null,
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
	relationshipSchemaPluginId: Schema.Null,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

export type MembershipRelationship = typeof MembershipRelationship.Type;

export const MembershipResponse = Schema.Struct({
	memberOf: MembershipRelationship,
	warnings: Schema.Array(AutomationWarning),
});

export type MembershipResponse = typeof MembershipResponse.Type;

export const maximumCollectionNameLength = 200;

const CollectionName = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				value.trim().length <= maximumCollectionNameLength ||
				`Collection names are at most ${maximumCollectionNameLength} characters`,
		),
	),
);

const CollectionDescription = Schema.String.pipe(Schema.check(Schema.isMaxLength(2000)));

export const CreateCollectionBody = Schema.Struct({
	name: CollectionName,
	description: Schema.optional(CollectionDescription),
	fields: Schema.optional(Schema.Array(CollectionField)),
});

export type CreateCollectionBody = typeof CreateCollectionBody.Type;

export const UpdateCollectionBody = Schema.Struct({
	name: CollectionName,
	collectionId: EntityId,
	fields: Schema.Array(CollectionField),
	description: Schema.NullOr(CollectionDescription),
});

export type UpdateCollectionBody = typeof UpdateCollectionBody.Type;

export const DeleteCollectionBody = Schema.Struct({ collectionId: EntityId });

export type DeleteCollectionBody = typeof DeleteCollectionBody.Type;

export const DeleteCollectionResponse = Schema.Struct({
	id: EntityId,
	warnings: Schema.Array(AutomationWarning),
});

export type DeleteCollectionResponse = typeof DeleteCollectionResponse.Type;

export const CreateMembershipBody = Schema.Struct({
	entityId: EntityId,
	collectionId: EntityId,
	properties: Schema.optional(Schema.Unknown),
	mode: Schema.optional(Schema.Literals(["upsert", "add-if-absent"])),
});

export type CreateMembershipBody = typeof CreateMembershipBody.Type;

export const DeleteMembershipBody = Schema.Struct({ entityId: EntityId, collectionId: EntityId });

export type DeleteMembershipBody = typeof DeleteMembershipBody.Type;
