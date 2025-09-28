import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";

import { AuthMiddleware } from "~/lib/auth";
import { BadRequest, NotFound, NotImplemented, RateLimited, Unauthorized } from "~/lib/errors";

import {
	CollectionResponse,
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteMembershipBody,
	MembershipResponse,
} from "./schemas";

export const CollectionsGroup = HttpApiGroup.make("collections")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.post("create", "/collections")
			.setPayload(CreateCollectionBody)
			.addSuccess(CollectionResponse, { status: 201 })
			.addError(BadRequest, { status: 400 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("createMembership", "/collections/memberships")
			.setPayload(CreateMembershipBody)
			.addSuccess(MembershipResponse, { status: 201 })
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.del("deleteMembership", "/collections/memberships")
			.setPayload(DeleteMembershipBody)
			.addSuccess(MembershipResponse)
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
