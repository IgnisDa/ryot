import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { CreateEventItem, CreateEventsResponse, EventsInternalError } from "./schemas";

export const EventsGroup = HttpApiGroup.make("events")
	.annotate(OpenApi.Description, "Create entity events.")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("create", "/events", {
			payload: Schema.Array(CreateEventItem),
			error: [EventsInternalError.pipe(HttpApiSchema.status(500))],
			success: CreateEventsResponse.pipe(HttpApiSchema.status(201)),
		}).annotate(
			OpenApi.Description,
			"Create one or more events. Policy failures stop the batch; rejected items are skipped. Required-hook warnings do not roll back written events.",
		),
	)
	.middleware(AuthMiddleware);
