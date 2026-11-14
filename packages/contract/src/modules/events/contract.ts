import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { EventId } from "../../schema/brands";
import {
	CreateEventItem,
	CreateEventsResponse,
	EventBadRequest,
	EventMutationResponse,
	EventNotFound,
	EventsInternalError,
	EventStale,
	EventUpdateRequest,
} from "./schemas";

export const EventsGroup = HttpApiGroup.make("events")
	.annotate(OpenApi.Description, "Create and mutate entity events.")
	.add(
		AuthenticatedMutationEndpoint.post("demo-write")("create", "/events", {
			payload: Schema.Array(CreateEventItem),
			error: [EventsInternalError.pipe(HttpApiSchema.status(500))],
			success: CreateEventsResponse.pipe(HttpApiSchema.status(201)),
		}).annotate(
			OpenApi.Description,
			"Create events and return each item's outcome. Policy failures stop the batch and required-hook warnings do not roll back committed events.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.patch("demo-write")("update", "/events/:eventId", {
			payload: EventUpdateRequest,
			params: { eventId: EventId },
			success: EventMutationResponse,
			error: [
				EventBadRequest.pipe(HttpApiSchema.status(400)),
				EventNotFound.pipe(HttpApiSchema.status(404)),
				EventStale.pipe(HttpApiSchema.status(409)),
				EventsInternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Update an event owned by the authenticated user."),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("demo-write")("delete", "/events/:eventId", {
			params: { eventId: EventId },
			success: EventMutationResponse,
			error: [
				EventBadRequest.pipe(HttpApiSchema.status(400)),
				EventNotFound.pipe(HttpApiSchema.status(404)),
				EventStale.pipe(HttpApiSchema.status(409)),
				EventsInternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Delete an event owned by the authenticated user."),
	)
	.middleware(AuthMiddleware);
