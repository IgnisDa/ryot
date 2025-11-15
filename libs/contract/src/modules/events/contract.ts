import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { EntityId } from "../../schema/brands";
import { CreateEventItem, CreateEventsResponse, ListedEvent } from "./schemas";

export const EventsGroup = HttpApiGroup.make("events")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("list", "/events")
			.setUrlParams(
				Schema.Struct({
					entityId: Schema.optional(EntityId),
					eventSchemaSlug: Schema.optional(Schema.String),
					sessionEntityId: Schema.optional(EntityId),
				}),
			)
			.addSuccess(Schema.Array(ListedEvent))
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("create", "/events")
			.setPayload(Schema.Array(CreateEventItem))
			.addSuccess(CreateEventsResponse, { status: 201 })
			.addError(NotFound, { status: 404 }),
	);
