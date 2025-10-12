import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "#lib/auth-middleware";
import { BadRequest, NotFound, RateLimited, Unauthorized } from "#lib/errors";

import { ClearUserStateResponse } from "./schemas";

const entityIdParam = HttpApiSchema.param("entityId", Schema.String);

export const UserStateGroup = HttpApiGroup.make("userState")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.del("clearUserState")`/entities/${entityIdParam}/user-state`
			.addSuccess(ClearUserStateResponse)
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 }),
	);
