import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { CreateRelationshipBody, RelationshipScope } from "./schemas";

export const RelationshipsGroup = HttpApiGroup.make("relationships")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("create", "/relationships")
			.setPayload(CreateRelationshipBody)
			.addSuccess(RelationshipScope, { status: 201 })
			.addError(NotFound, { status: 404 }),
	);
