import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { EntityId, EventSchemaSlug } from "../../schema/brands";
import { CreateEventItem, CreateEventsResponse, ListedEvent } from "./schemas";

export const EventsGroup = HttpApiGroup.make("events")
	.annotate(OpenApi.Description, "List and create entity events.")
	.add(
		HttpApiEndpoint.get("list", "/events", {
			query: {
				entityId: Schema.optional(EntityId),
				eventSchemaSlug: Schema.optional(EventSchemaSlug),
				sessionEntityId: Schema.optional(EntityId),
			},
			success: Schema.Array(ListedEvent),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "List events matching the requested filters."),
	)
	.add(
		HttpApiEndpoint.post("create", "/events", {
			payload: Schema.Array(CreateEventItem),
			success: CreateEventsResponse.pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Create one or more events."),
	)
	.middleware(AuthMiddleware);
