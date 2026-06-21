import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import {
	CollectionResponse,
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteMembershipBody,
	MembershipResponse,
} from "./schemas";

export const CollectionsGroup = HttpApiGroup.make("collections")
	.annotate(OpenApi.Description, "Manages collections and their memberships")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("create", "/collections")
			.setPayload(CreateCollectionBody)
			.addSuccess(CollectionResponse, { status: 201 })
			.annotate(OpenApi.Description, "Creates a collection"),
	)
	.add(
		HttpApiEndpoint.post("createMembership", "/collections/memberships")
			.setPayload(CreateMembershipBody)
			.addSuccess(MembershipResponse, { status: 201 })
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Adds an entity to a collection"),
	)
	.add(
		HttpApiEndpoint.del("deleteMembership", "/collections/memberships")
			.setPayload(DeleteMembershipBody)
			.addSuccess(MembershipResponse)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Removes an entity from a collection"),
	);
