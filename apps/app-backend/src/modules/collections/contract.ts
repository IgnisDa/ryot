import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { NotFound, NotImplemented, Unauthorized } from "../../lib/errors";

const MembershipRelationship = Schema.Struct({
	id: Schema.String,
	createdAt: Schema.String,
	properties: Schema.Unknown,
	sourceEntityId: Schema.String,
	targetEntityId: Schema.String,
	relationshipSchemaId: Schema.String,
});

const CollectionResponse = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaId: Schema.String,
});

const CreateCollectionBody = Schema.Struct({
	name: Schema.String,
	description: Schema.optional(Schema.String),
	membershipPropertiesSchema: Schema.optional(Schema.Unknown),
});

const CreateMembershipBody = Schema.Struct({
	entityId: Schema.String,
	collectionId: Schema.String,
	properties: Schema.optional(Schema.Unknown),
});

const DeleteMembershipBody = Schema.Struct({
	entityId: Schema.String,
	collectionId: Schema.String,
});

const MembershipResponse = Schema.Struct({ memberOf: MembershipRelationship });

export const CollectionsGroup = HttpApiGroup.make("collections")
	.add(
		HttpApiEndpoint.post("create", "/collections")
			.setPayload(CreateCollectionBody)
			.addSuccess(CollectionResponse, { status: 201 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("createMembership", "/collections/memberships")
			.setPayload(CreateMembershipBody)
			.addSuccess(MembershipResponse, { status: 201 })
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.del("deleteMembership", "/collections/memberships")
			.setPayload(DeleteMembershipBody)
			.addSuccess(MembershipResponse)
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
