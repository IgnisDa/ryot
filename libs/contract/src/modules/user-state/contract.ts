import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { EntityId } from "../../schema/brands";
import { ClearUserStateResponse, MergeUserStateBody, MergeUserStateResponse } from "./schemas";

const entityIdParam = HttpApiSchema.param("entityId", EntityId);

export const UserStateGroup = HttpApiGroup.make("userState")
	.annotate(OpenApi.Description, "Manage user state for entities.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.del("clearUserState")`/user-state/clear/${entityIdParam}`
			.annotate(OpenApi.Description, "Clear the user's state for an entity.")
			.addSuccess(ClearUserStateResponse)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("mergeUserState", "/user-state/merge")
			.annotate(OpenApi.Description, "Merge changes into the user's entity state.")
			.setPayload(MergeUserStateBody)
			.addSuccess(MergeUserStateResponse)
			.addError(NotFound, { status: 404 }),
	);
