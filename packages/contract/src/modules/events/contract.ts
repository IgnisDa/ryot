import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { CreateEventItem, CreateEventsResponse } from "./schemas";

export const EventsGroup = HttpApiGroup.make("events")
	.annotate(OpenApi.Description, "Create entity events.")
	.add(
		HttpApiEndpoint.post("create", "/events", {
			payload: Schema.Array(CreateEventItem),
			success: CreateEventsResponse.pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Create one or more events."),
	)
	.middleware(AuthMiddleware);
