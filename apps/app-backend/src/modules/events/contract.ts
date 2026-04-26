import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "~/lib/auth";
import { BadRequest, NotFound, RateLimited, Unauthorized } from "~/lib/errors";

import { CreateEventItem, CreateEventsResponse, ListedEvent } from "./schemas";

export const EventsGroup = HttpApiGroup.make("events")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.get("list", "/events")
			.setUrlParams(
				Schema.Struct({
					entityId: Schema.optional(Schema.String),
					eventSchemaSlug: Schema.optional(Schema.String),
					sessionEntityId: Schema.optional(Schema.String),
				}),
			)
			.addSuccess(Schema.Array(ListedEvent))
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/events")
			.setPayload(Schema.Array(CreateEventItem))
			.addSuccess(CreateEventsResponse, { status: 201 })
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	);
