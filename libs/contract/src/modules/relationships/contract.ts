import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { CreateRelationshipBody, RelationshipScope } from "./schemas";

export const RelationshipsGroup = HttpApiGroup.make("relationships")
	.annotate(OpenApi.Description, "Manage relationships between entities.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("create", "/relationships")
			.annotate(OpenApi.Description, "Create a relationship between entities.")
			.setPayload(CreateRelationshipBody)
			.addSuccess(RelationshipScope, { status: 201 })
			.addError(NotFound, { status: 404 }),
	);
