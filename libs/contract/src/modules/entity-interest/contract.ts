import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { DeclareInterestBody, DeclareInterestResponse } from "./messages";

export const InterestGroup = HttpApiGroup.make("entity-interest")
	.annotate(OpenApi.Description, "Declare and stream interest in entity updates.")
	.addError(Unauthorized, { status: 401 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("stream", "/entity-interest/stream")
			.annotate(OpenApi.Description, "Stream entity updates for an interest session.")
			.setUrlParams(Schema.Struct({ streamId: Schema.String }))
			.addSuccess(HttpApiSchema.Text({ contentType: "text/event-stream" })),
	)
	.add(
		HttpApiEndpoint.post("declareInterest", "/entity-interest")
			.annotate(OpenApi.Description, "Declare interest in entity updates.")
			.setPayload(DeclareInterestBody)
			.addSuccess(DeclareInterestResponse)
			.addError(NotFound, { status: 404 })
			.addError(RateLimited, { status: 429 }),
	);
