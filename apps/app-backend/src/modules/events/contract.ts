import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { NotFound, NotImplemented, RateLimited, Unauthorized } from "../../lib/errors";

export const ListedEvent = Schema.Struct({
	id: Schema.String,
	entityId: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	properties: Schema.Unknown,
	eventSchemaId: Schema.String,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	sessionEntityId: Schema.optional(Schema.String),
});

const CreateEventItem = Schema.Struct({
	properties: Schema.Unknown,
	entityId: Schema.String,
	eventSchemaId: Schema.String,
	occurredAt: Schema.optional(Schema.String),
	sessionEntityId: Schema.optional(Schema.String),
});

const CreateEventsResponse = Schema.Struct({ count: Schema.Number });

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
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/events")
			.setPayload(Schema.Array(CreateEventItem))
			.addSuccess(CreateEventsResponse, { status: 201 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
