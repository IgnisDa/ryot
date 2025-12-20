import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { EntityId } from "../../schema/brands";
import { ClearUserStateResponse, MergeUserStateBody, MergeUserStateResponse } from "./schemas";

const entityIdParam = HttpApiSchema.param("entityId", EntityId);

export const UserStateGroup = HttpApiGroup.make("userState")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.del("clearUserState")`/user-state/clear/${entityIdParam}`
			.addSuccess(ClearUserStateResponse)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("mergeUserState", "/user-state/merge")
			.setPayload(MergeUserStateBody)
			.addSuccess(MergeUserStateResponse)
			.addError(NotFound, { status: 404 }),
	);
