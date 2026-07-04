import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { DeclareInterestBody, DeclareInterestResponse } from "./messages";

export const InterestGroup = HttpApiGroup.make("entity-interest")
	.annotate(OpenApi.Description, "Declare and stream interest in entity updates.")
	.add(
		HttpApiEndpoint.get("stream", "/entity-interest/stream", {
			query: { streamId: Schema.String },
			success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Stream entity updates for an interest session."),
	)
	.add(
		HttpApiEndpoint.post("declareInterest", "/entity-interest", {
			payload: DeclareInterestBody,
			success: DeclareInterestResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Declare interest in entity updates."),
	)
	.middleware(AuthMiddleware);
