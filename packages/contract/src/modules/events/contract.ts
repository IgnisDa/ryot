import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { EventId } from "../../schema/brands";
import {
	CreateEventItem,
	CreateEventsResponse,
	EventBadRequest,
	EventCreateOperation,
	EventCreatePending,
	EventMutationResponse,
	EventNotFound,
	EventOperationNotFound,
	EventStale,
	EventsInternalError,
	EventUpdatePatch,
} from "./schemas";

export const EventsGroup = HttpApiGroup.make("events")
	.annotate(OpenApi.Description, "Create and mutate entity events.")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("create", "/events", {
			payload: Schema.Array(CreateEventItem),
			error: [EventsInternalError.pipe(HttpApiSchema.status(500))],
			success: [
				CreateEventsResponse.pipe(HttpApiSchema.status(201)),
				EventCreatePending.pipe(HttpApiSchema.status(202)),
			],
		}).annotate(
			OpenApi.Description,
			"Create events within a 35-second observation budget. A 202 response identifies the continuing operation; policy failures stop the batch and required-hook warnings do not roll back committed events.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.patch("allowed")("update", "/events/:eventId", {
			payload: EventUpdatePatch,
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
		AuthenticatedMutationEndpoint.delete("allowed")("delete", "/events/:eventId", {
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
	.add(
		HttpApiEndpoint.get("getCreateOperation", "/events/operations/:operationId", {
			success: EventCreateOperation,
			params: { operationId: Schema.String },
			error: [
				EventsInternalError.pipe(HttpApiSchema.status(500)),
				EventOperationNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(
			OpenApi.Description,
			"Retrieve an event creation operation's current state and result.",
		),
	)
	.middleware(AuthMiddleware);
