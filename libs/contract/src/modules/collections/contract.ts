import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";

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
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("create", "/collections")
			.setPayload(CreateCollectionBody)
			.addSuccess(CollectionResponse, { status: 201 }),
	)
	.add(
		HttpApiEndpoint.post("createMembership", "/collections/memberships")
			.setPayload(CreateMembershipBody)
			.addSuccess(MembershipResponse, { status: 201 })
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.del("deleteMembership", "/collections/memberships")
			.setPayload(DeleteMembershipBody)
			.addSuccess(MembershipResponse)
			.addError(NotFound, { status: 404 }),
	);
