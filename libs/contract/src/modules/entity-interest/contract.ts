import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { DeclareInterestBody, DeclareInterestResponse } from "./messages";

export const InterestGroup = HttpApiGroup.make("entity-interest")
	.addError(Unauthorized, { status: 401 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("stream", "/entity-interest/stream")
			.setUrlParams(Schema.Struct({ streamId: Schema.String }))
			.addSuccess(HttpApiSchema.Text({ contentType: "text/event-stream" })),
	)
	.add(
		HttpApiEndpoint.post("declareInterest", "/entity-interest")
			.setPayload(DeclareInterestBody)
			.addSuccess(DeclareInterestResponse)
			.addError(NotFound, { status: 404 })
			.addError(RateLimited, { status: 429 }),
	);
