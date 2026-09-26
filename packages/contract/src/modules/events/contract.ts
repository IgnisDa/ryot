import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import {
	CreateEventItem,
	CreateEventsResponse,
	EventCreateOperation,
	EventCreatePending,
	EventOperationNotFound,
	EventsInternalError,
} from "./schemas";

export const EventsGroup = HttpApiGroup.make("events")
	.annotate(OpenApi.Description, "Create entity events.")
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
