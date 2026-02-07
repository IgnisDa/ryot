import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";

import { AuthMiddleware } from "#lib/auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "#lib/errors";

import { DeclareInterestBody, DeclareInterestResponse } from "./messages";

export const InterestGroup = HttpApiGroup.make("interest")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("declareInterest", "/interest")
			.setPayload(DeclareInterestBody)
			.addSuccess(DeclareInterestResponse)
			.addError(NotFound, { status: 404 }),
	);
